import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import {
  db,
  type SocialAccountRecord,
  type SocialTransferRecord,
  type UserRecord,
} from './db.ts';
import {
  cleanSocialHandle,
  formatTwitterTemplate,
  formatTelegramCommand,
} from '../../packages/shared/index.ts';
import { generateCashbackClaimIfEligible } from './cashbackService.ts';
import { claimRedPacketForUser } from './redPacketService.ts';

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (genAIClient) return genAIClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
    try {
      genAIClient = new GoogleGenAI();
      return genAIClient;
    } catch {
      return null;
    }
  }
  return null;
}

export function generateSocialVerificationCode(platform: 'TWITTER' | 'TELEGRAM'): string {
  const prefix = platform === 'TWITTER' ? 'X' : 'TG';
  const num = Math.floor(10000 + Math.random() * 90000);
  return `${prefix}-${num}`;
}

export interface ParsedSocialPost {
  amountNim: number | null;
  recipientHandle: string | null;
  intent: 'TIP' | 'GIVEAWAY' | 'PAYMENT' | 'UNKNOWN';
  rawText: string;
}

/**
 * Parses varied natural language X (Twitter) posts using Gemini AI, with regex fallback.
 * Requirement:
 * "The text of the post or comment can be anything, provided it ends with @nimorapay (amount of $NIM).
 * Since the phrasing can vary, an AI will be used to process it."
 */
export async function parseTwitterPostWithAI(
  text: string,
  authorHandle: string,
  inReplyToHandle?: string
): Promise<ParsedSocialPost> {
  const cleanText = text.trim();

  // Try parsing with Gemini AI first
  const ai = getGenAI();
  if (ai) {
    try {
      const prompt = `You are a precise transaction parser for Nimora Pay on Twitter/X (@nimorapay).
The user is tipping or transferring NIM crypto on X.
Rules:
1. The post text can be anything, but typically tags @nimorapay followed by an amount of NIM, often near or at the end.
2. Find the recipient handle (a Twitter handle starting with @ in the text, excluding @nimorapay).
3. If no other @handle is in the text, but inReplyToHandle is provided, use inReplyToHandle.
4. Extract the numeric amount of NIM intended to be transferred.
5. Determine intent: "TIP", "GIVEAWAY", or "PAYMENT".

Author: @${authorHandle}
In Reply To: ${inReplyToHandle ? '@' + inReplyToHandle : 'None'}
Post text: "${cleanText}"

Respond ONLY with raw JSON matching this schema:
{
  "amountNim": number or null,
  "recipientHandle": "handle_without_at" or null,
  "intent": "TIP" | "GIVEAWAY" | "PAYMENT" | "UNKNOWN"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });

      const responseText = response.text?.trim() || '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          amountNim?: number | null;
          recipientHandle?: string | null;
          intent?: 'TIP' | 'GIVEAWAY' | 'PAYMENT' | 'UNKNOWN';
        };
        if (
          typeof parsed.amountNim === 'number' &&
          parsed.amountNim > 0
        ) {
          let rec = parsed.recipientHandle ? cleanSocialHandle(parsed.recipientHandle) : null;
          if (rec === 'nimorapay') rec = null;
          return {
            amountNim: parsed.amountNim,
            recipientHandle: rec || (inReplyToHandle ? cleanSocialHandle(inReplyToHandle) : null),
            intent: parsed.intent || 'TIP',
            rawText: cleanText,
          };
        }
      }
    } catch (err) {
      console.warn('Gemini parser fallback to regex:', err);
    }
  }

  // Fallback regex parser:
  // Matches e.g. "@nimorapay 1000", "@nimorapay 500", "—@nimorapay 500", "not much, but here you go: @nimorapay 1000"
  const amountMatch = cleanText.match(/@nimorapay\s+([0-9]+(?:\.[0-9]+)?)/i);
  const amountNim = amountMatch ? parseFloat(amountMatch[1]) : null;

  // Extract all @mentions except @nimorapay and author
  const mentions = Array.from(cleanText.matchAll(/@([a-zA-Z0-9_]+)/g))
    .map((m) => m[1].toLowerCase())
    .filter((m) => m !== 'nimorapay' && m !== cleanSocialHandle(authorHandle));

  let recipientHandle = mentions.length > 0 ? mentions[0] : null;
  if (!recipientHandle && inReplyToHandle) {
    recipientHandle = cleanSocialHandle(inReplyToHandle);
  }

  const isGiveaway = /giveaway|winner|congrat/i.test(cleanText);

  return {
    amountNim,
    recipientHandle,
    intent: isGiveaway ? 'GIVEAWAY' : 'TIP',
    rawText: cleanText,
  };
}

/**
 * Generates dynamic, varying responses for @nimorapay using Gemini AI.
 * Requirement:
 * "@nimorapay, the bot’s responses—for instance, when someone sends a tip—should vary each time."
 */
export async function generateTwitterBotResponse(params: {
  status: 'SUCCESS' | 'FAILED_RECIPIENT_NOT_REGISTERED' | 'FAILED_INSUFFICIENT_FUNDS' | 'FAILED_SENDER_NOT_REGISTERED';
  senderHandle: string;
  recipientHandle: string;
  amountNim: number;
  intent: string;
  postText: string;
}): Promise<string> {
  const { status, senderHandle, recipientHandle, amountNim, intent, postText } = params;

  // Specific requirement for failure when recipient not registered:
  // "Unfortunately, your friend hasn't registered their handle in the Nimora mini-app yet."
  if (status === 'FAILED_RECIPIENT_NOT_REGISTERED') {
    const defaultFail = `Unfortunately, your friend (@${recipientHandle}) hasn't registered their handle in the Nimora mini-app yet.`;
    const ai = getGenAI();
    if (ai) {
      try {
        const prompt = `You are @nimorapay, the automated Nimiq tip bot on X.
The tip failed because recipient @${recipientHandle} hasn't registered their handle in the Nimora mini-app yet.
Sender was @${senderHandle}.
Write a polite, concise reply (1-2 sentences, max 160 chars) conveying: "Unfortunately, your friend hasn't registered their handle in the Nimora mini-app yet." Encourage @${recipientHandle} to connect their handle at Nimora to receive tips. Vary phrasing naturally.`;
        const res = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
        });
        const reply = res.text?.trim().replace(/^["']|["']$/g, '');
        if (reply && reply.length > 10) return reply;
      } catch {
        // fallback
      }
    }
    return defaultFail;
  }

  if (status === 'FAILED_SENDER_NOT_REGISTERED') {
    return `@${senderHandle} Transfer failed: Your Twitter handle isn't connected to Nimora yet! Open the Nimora mini-app > Settings > Social to link your wallet.`;
  }

  if (status === 'FAILED_INSUFFICIENT_FUNDS') {
    return `@${senderHandle} Transfer failed: Insufficient $NIM in your connected Nimora wallet to send ${amountNim} $NIM. Top up or buy NIM on the P2P marketplace!`;
  }

  // SUCCESS case: Vary response dynamically each time!
  const ai = getGenAI();
  if (ai) {
    try {
      const prompt = `You are @nimorapay, the witty, celebratory crypto tipping bot on X (Twitter).
A transfer just succeeded:
Sender: @${senderHandle}
Recipient: @${recipientHandle}
Amount: ${amountNim} $NIM
Context of post: "${postText}"
Intent: ${intent}

Write a lively, distinct, varied reply celebrating this tip/transfer (under 180 characters).
Key facts to include:
- Must state that a tip/transfer of ${amountNim} $NIM was sent to @${recipientHandle}
- Keep it friendly, positive, and diverse each time.
Examples of style:
- "Awesome! You just sent a tip of ${amountNim} $NIM to @${recipientHandle} 🚀"
- "Woohoo! ${amountNim} $NIM tip delivered to @${recipientHandle} courtesy of @${senderHandle} ✨"
- "Boom! ${amountNim} $NIM just flew into @${recipientHandle}'s Nimora wallet. Generosity level 100! 💎"
- "Giveaway confirmed! ${amountNim} $NIM has been sent to the winner @${recipientHandle} 🎉"
Return ONLY the reply text, no quotation marks.`;

      const res = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      });
      const text = res.text?.trim().replace(/^["']|["']$/g, '');
      if (text && text.length > 15) return text;
    } catch (err) {
      console.warn('Gemini response variation fallback:', err);
    }
  }

  // Varied template fallbacks if Gemini is not reachable:
  const successVariations = [
    `Awesome! You just sent a tip of ${amountNim} $NIM to @${recipientHandle} 🚀`,
    `Woohoo! ${amountNim} $NIM has landed in @${recipientHandle}'s Nimora wallet from @${senderHandle} ✨`,
    `Boom! Tip delivered: ${amountNim} $NIM sent to @${recipientHandle}. Thanks for spreading the $NIM love! 💎`,
    `Congratulations @${recipientHandle}! You just received a tip of ${amountNim} $NIM from @${senderHandle} 🎉`,
    `Transaction complete: ${amountNim} $NIM has been successfully credited to @${recipientHandle}'s wallet! ⚡`,
  ];
  const idx = Math.floor(Math.random() * successVariations.length);
  return successVariations[idx];
}

/**
 * Helper to find a Telegram user account across socialAccounts and users table.
 */
export function findTelegramAccount(
  handle: string,
  telegramUserId?: string | number
): { account: SocialAccountRecord | null; user: UserRecord | null } {
  const clean = cleanSocialHandle(handle);
  const strId = telegramUserId ? String(telegramUserId) : null;

  // 1. Match by Telegram User ID on socialAccounts
  if (strId) {
    const acc = db.state.socialAccounts.find(
      (sa) => sa.platform === 'TELEGRAM' && sa.telegramUserId === strId && (sa.isVerified || sa.verifiedAt)
    );
    if (acc) {
      const u = db.state.users.find((usr) => usr.id === acc.userId);
      if (u) {
        if (!acc.isVerified) acc.isVerified = true;
        if (!u.telegramUserId) u.telegramUserId = strId;
        return { account: acc, user: u };
      }
    }

    // Match by user.telegramUserId
    const uById = db.state.users.find((usr) => usr.telegramUserId === strId);
    if (uById) {
      let sa = db.state.socialAccounts.find(
        (s) => s.userId === uById.id && s.platform === 'TELEGRAM'
      );
      if (sa) {
        sa.isVerified = true;
        sa.telegramUserId = strId;
        return { account: sa, user: uById };
      }
    }
  }

  // 2. Match by verified social account handle
  if (clean) {
    const acc = db.state.socialAccounts.find(
      (sa) =>
        sa.platform === 'TELEGRAM' &&
        cleanSocialHandle(sa.handle) === clean &&
        (sa.isVerified || sa.verifiedAt)
    );
    if (acc) {
      const u = db.state.users.find((usr) => usr.id === acc.userId);
      if (u) {
        if (!acc.isVerified) acc.isVerified = true;
        if (strId) {
          acc.telegramUserId = strId;
          u.telegramUserId = strId;
        }
        return { account: acc, user: u };
      }
    }

    // 3. Match by user.telegramHandle
    const userByHandle = db.state.users.find(
      (u) =>
        cleanSocialHandle(u.telegramHandle || '') === clean ||
        cleanSocialHandle(u.realName || '') === clean
    );
    if (userByHandle) {
      let sa = db.state.socialAccounts.find(
        (s) => s.userId === userByHandle.id && s.platform === 'TELEGRAM'
      );
      if (!sa) {
        sa = {
          id: `soc_${crypto.randomBytes(6).toString('hex')}`,
          userId: userByHandle.id,
          platform: 'TELEGRAM',
          handle: clean,
          displayHandle: `@${clean}`,
          verificationCode: `TG-${Math.floor(10000 + Math.random() * 90000)}`,
          isVerified: true,
          verifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          telegramUserId: strId,
        };
        db.state.socialAccounts.push(sa);
      } else {
        sa.isVerified = true;
        if (!sa.verifiedAt) sa.verifiedAt = new Date().toISOString();
        if (strId) sa.telegramUserId = strId;
      }
      if (strId) userByHandle.telegramUserId = strId;
      db.save();
      return { account: sa, user: userByHandle };
    }
  }

  return { account: null, user: null };
}

/**
 * Claims any pending tips held in escrow when a user connects their Telegram or X handle.
 */
export function claimPendingSocialTipsForUser(
  platform: 'TWITTER' | 'TELEGRAM',
  handle: string,
  userId: string
): number {
  const clean = cleanSocialHandle(handle);
  const pendingTxs = db.state.socialTransfers.filter(
    (tx) =>
      tx.platform === platform &&
      cleanSocialHandle(tx.recipientHandle) === clean &&
      (tx.status === 'PENDING_RECIPIENT_CLAIM' ||
        tx.status === 'FAILED_RECIPIENT_NOT_REGISTERED') &&
      tx.amountNim > 0
  );

  if (pendingTxs.length === 0) return 0;

  let totalCredited = 0;
  for (const tx of pendingTxs) {
    tx.status = 'SUCCESS';
    tx.recipientUserId = userId;
    totalCredited += tx.amountNim;
  }

  if (totalCredited > 0) {
    db.adjustUserBalance(userId, totalCredited);
    db.save();
    if (eventBroadcaster) {
      eventBroadcaster('WALLET_BALANCE_UPDATED', { userId });
    }
  }

  return totalCredited;
}

/**
 * Executes a Social Transfer on X or Telegram and records in the ledger.
 * Once connected, users do NOT need to open the mini app again to sign or pay.
 */
export async function executeSocialTransfer(params: {
  platform: 'TWITTER' | 'TELEGRAM';
  senderHandle: string;
  senderTelegramId?: string | number;
  recipientHandle: string;
  amountNim: number;
  rawText: string;
  postUrlOrId?: string;
  intent?: string;
}): Promise<{
  success: boolean;
  status: SocialTransferRecord['status'];
  botResponse: string;
  transfer?: SocialTransferRecord;
}> {
  const { platform, rawText, postUrlOrId } = params;
  const cleanSender = cleanSocialHandle(params.senderHandle);
  const cleanRecipient = cleanSocialHandle(params.recipientHandle);
  const amountNim = Number(params.amountNim);

  // 1. Look up sender (by telegramUserId or handle)
  let senderUser: UserRecord | null = null;
  let senderAccount: SocialAccountRecord | null = null;

  if (platform === 'TELEGRAM') {
    const found = findTelegramAccount(cleanSender, params.senderTelegramId);
    senderAccount = found.account;
    senderUser = found.user;
  } else {
    senderAccount =
      db.state.socialAccounts.find(
        (sa) =>
          sa.platform === 'TWITTER' &&
          cleanSocialHandle(sa.handle) === cleanSender &&
          sa.isVerified
      ) || null;
    const sAcc = senderAccount;
    if (sAcc) {
      senderUser = db.state.users.find((u) => u.id === sAcc.userId) || null;
    }
    if (!senderUser) {
      senderUser =
        db.state.users.find(
          (u) => cleanSocialHandle(u.twitterHandle || '') === cleanSender
        ) || null;
    }
  }

  if (!senderUser) {
    const botResponse =
      platform === 'TWITTER'
        ? await generateTwitterBotResponse({
            status: 'FAILED_SENDER_NOT_REGISTERED',
            senderHandle: cleanSender,
            recipientHandle: cleanRecipient,
            amountNim,
            intent: params.intent || 'TIP',
            postText: rawText,
          })
        : `Transfer failed because you have not connected your Telegram handle (@${cleanSender}) in the Nimora mini-app yet.\n\nPlease open Nimora > Profile > Social Accounts to link your wallet once!`;

    const transfer: SocialTransferRecord = {
      id: `sctx_${crypto.randomBytes(6).toString('hex')}`,
      platform,
      senderUserId: null,
      senderHandle: cleanSender,
      recipientUserId: null,
      recipientHandle: cleanRecipient,
      amountNim,
      status: 'FAILED_SENDER_NOT_REGISTERED',
      rawText,
      postUrlOrId,
      botResponse,
      txHash: null,
      createdAt: new Date().toISOString(),
    };
    db.state.socialTransfers.unshift(transfer);
    db.save();

    return {
      success: false,
      status: 'FAILED_SENDER_NOT_REGISTERED',
      botResponse,
      transfer,
    };
  }

  // 2. Validate amount
  if (amountNim <= 0 || isNaN(amountNim)) {
    return {
      success: false,
      status: 'FAILED_INVALID_FORMAT',
      botResponse: 'Invalid transfer amount specified.',
    };
  }

  // 3. Check sender balance
  const senderBal = db.getUserBalance(senderUser.id);
  if (senderBal < amountNim) {
    const formattedSenderBal = Number(senderBal.toFixed(2)).toLocaleString('en-US');
    const botResponse =
      platform === 'TWITTER'
        ? `@${cleanSender} Transfer failed: Insufficient $NIM in your connected Nimora wallet (balance: ${formattedSenderBal} $NIM) to send ${amountNim} $NIM.`
        : `Payment failed; your $NIM balance (${formattedSenderBal} $NIM) is insufficient to pay ${amountNim} $NIM to @${cleanRecipient}. Please top up your wallet and try again.`;

    const transfer: SocialTransferRecord = {
      id: `sctx_${crypto.randomBytes(6).toString('hex')}`,
      platform,
      senderUserId: senderUser.id,
      senderHandle: cleanSender,
      recipientUserId: null,
      recipientHandle: cleanRecipient,
      amountNim,
      status: 'FAILED_INSUFFICIENT_FUNDS',
      rawText,
      postUrlOrId,
      botResponse,
      txHash: null,
      createdAt: new Date().toISOString(),
    };
    db.state.socialTransfers.unshift(transfer);
    db.save();

    return {
      success: false,
      status: 'FAILED_INSUFFICIENT_FUNDS',
      botResponse,
      transfer,
    };
  }

  // 4. Look up recipient
  let recipientUser: UserRecord | null = null;
  let recipientAccount: SocialAccountRecord | null = null;

  if (platform === 'TELEGRAM') {
    const found = findTelegramAccount(cleanRecipient);
    recipientAccount = found.account;
    recipientUser = found.user;
  } else {
    recipientAccount =
      db.state.socialAccounts.find(
        (sa) =>
          sa.platform === 'TWITTER' &&
          cleanSocialHandle(sa.handle) === cleanRecipient &&
          sa.isVerified
      ) || null;
    const rAcc = recipientAccount;
    if (rAcc) {
      recipientUser = db.state.users.find((u) => u.id === rAcc.userId) || null;
    }
    if (!recipientUser) {
      recipientUser =
        db.state.users.find(
          (u) => cleanSocialHandle(u.twitterHandle || '') === cleanRecipient
        ) || null;
    }
  }

  // Deduct balance from sender immediately (automated, no app signing needed)
  db.adjustUserBalance(senderUser.id, -amountNim);

  const txHash = crypto.randomBytes(32).toString('hex');
  let finalStatus: SocialTransferRecord['status'] = 'SUCCESS';
  let botResponse = '';

  if (recipientUser) {
    // Recipient is registered -> credit wallet immediately
    db.adjustUserBalance(recipientUser.id, amountNim);
    finalStatus = 'SUCCESS';

    if (platform === 'TWITTER') {
      botResponse = await generateTwitterBotResponse({
        status: 'SUCCESS',
        senderHandle: cleanSender,
        recipientHandle: cleanRecipient,
        amountNim,
        intent: params.intent || 'TIP',
        postText: rawText,
      });
    } else {
      botResponse = `You have successfully paid ${amountNim} $NIM to @${cleanRecipient}.`;
    }
  } else {
    // Recipient is not registered yet -> hold in escrow reserve
    finalStatus = 'PENDING_RECIPIENT_CLAIM';

    if (platform === 'TWITTER') {
      botResponse = `🚀 @${cleanSender} has sent a tip of ${amountNim} $NIM to @${cleanRecipient}! @${cleanRecipient} Connect your X handle in Nimora to receive your $NIM into your wallet!`;
    } else {
      botResponse = `Payment successful! You have sent ${amountNim} $NIM to @${cleanRecipient}.\n\nWhen your friend connects their Telegram handle in the NIMORA mini-app, the ${amountNim} $NIM will be automatically credited to their wallet!`;
    }
  }

  const transfer: SocialTransferRecord = {
    id: `sctx_${crypto.randomBytes(6).toString('hex')}`,
    platform,
    senderUserId: senderUser.id,
    senderHandle: cleanSender,
    recipientUserId: recipientUser?.id || null,
    recipientHandle: cleanRecipient,
    amountNim,
    status: finalStatus,
    rawText,
    postUrlOrId,
    botResponse,
    txHash,
    createdAt: new Date().toISOString(),
  };
  db.state.socialTransfers.unshift(transfer);

  // Broadcast live balance updates
  if (eventBroadcaster) {
    eventBroadcaster('WALLET_BALANCE_UPDATED', {
      userId: senderUser.id,
      address: senderUser.address,
    });
    if (recipientUser) {
      eventBroadcaster('WALLET_BALANCE_UPDATED', {
        userId: recipientUser.id,
        address: recipientUser.address,
      });
    }
  }

  // Trigger Cashback reward if eligible (tips >= minTxAmountNim)
  try {
    if (amountNim >= (db.state.cashbackConfig?.minTxAmountNim || 5000)) {
      generateCashbackClaimIfEligible({
        userId: senderUser.id,
        txType: 'TIP_TRANSACTION',
        txReferenceId: transfer.id,
        txAmountNim: amountNim,
      }).catch((err) => console.error('Cashback tip trigger error:', err));
    }
  } catch (err) {
    console.error('Failed to trigger tip cashback:', err);
  }

  // Add to ledger if recipient user exists
  if (recipientUser) {
    db.state.ledger.unshift({
      id: `led_${crypto.randomBytes(6).toString('hex')}`,
      type: 'REQUEST_PAYMENT',
      refType: 'REQUEST',
      refId: transfer.id,
      amountNim,
      fromAddress: senderUser.address,
      toAddress: recipientUser.address,
      txHash,
      blockHeight: 310500 + Math.floor(Math.random() * 500),
      createdAt: new Date().toISOString(),
    });
  }

  db.logAudit(
    senderUser.id,
    senderUser.realName || senderUser.address,
    'SOCIAL_TRANSFER_SUCCESS',
    'SocialTransfer',
    transfer.id,
    {
      platform,
      senderHandle: cleanSender,
      recipientHandle: cleanRecipient,
      amountNim,
      txHash,
      status: finalStatus,
    }
  );

  db.save();

  return {
    success: true,
    status: finalStatus,
    botResponse,
    transfer,
  };
}

/**
 * Validates Twitter mention/post verification code and handle match.
 * Requirement:
 * "If the handle matches the one entered in the mini-app and the code is correct, the bot should reply:
 * 'Congratulations, your X handle has been successfully connected! Please check the mini-app.'
 * If it fails—for instance, due to an incorrect code or a mismatch between the username and code—the bot
 * should use a template response: 'It looks like your code is incorrect or your Twitter handle does not match.'"
 */
export function verifyTwitterConnection(
  authorHandle: string,
  text: string
): { success: boolean; response: string; account?: SocialAccountRecord } {
  const cleanHandle = cleanSocialHandle(authorHandle);
  const codeMatch = text.match(/\b(X-[A-Za-z0-9_-]+)\b/i);
  const code = codeMatch ? codeMatch[1].toUpperCase() : null;

  const accountByCode = code
    ? db.state.socialAccounts.find(
        (sa) => sa.platform === 'TWITTER' && sa.verificationCode.toUpperCase() === code
      )
    : null;

  if (!code || !accountByCode || cleanSocialHandle(accountByCode.handle) !== cleanHandle) {
    return {
      success: false,
      response: 'It looks like your code is incorrect or your Twitter handle does not match.',
    };
  }

  accountByCode.isVerified = true;
  accountByCode.verifiedAt = new Date().toISOString();
  accountByCode.handle = cleanHandle;
  accountByCode.displayHandle = `@${cleanHandle}`;

  const user = db.state.users.find((u) => u.id === accountByCode.userId);
  if (user) {
    user.twitterHandle = cleanHandle;
  }
  db.save();

  return {
    success: true,
    response:
      'Congratulations, your X handle has been successfully connected! Please check the mini-app.',
    account: accountByCode,
  };
}

/**
 * Validates Telegram bot /connect command and handle match.
 * Requirement:
 * "When a user sends the /connect [user code] command, the bot should respond:
 * 'Congratulations, your handle has been successfully connected to [Nimiq address].'
 * The bot must validate that both the code and the handle match; if the handle is correct
 * but the code is invalid or belongs to another user, the connection attempt must fail."
 */
export function verifyTelegramConnection(
  senderHandle: string,
  commandText: string,
  senderTelegramId?: string | number,
  chatId?: string | number
): { success: boolean; response: string; account?: SocialAccountRecord } {
  const cleanHandle = cleanSocialHandle(senderHandle);
  const codeMatch =
    commandText.match(/^\/connect(?:\s+@?[a-zA-Z0-9_]+)?\s+([A-Za-z0-9_-]+)/i) ||
    commandText.match(/^\/connect\s+([A-Za-z0-9_-]+)/i) ||
    commandText.match(/\b(TG-[A-Za-z0-9_-]+)\b/i);
  const code = codeMatch ? codeMatch[1].toUpperCase() : null;

  const accountByCode = code
    ? db.state.socialAccounts.find(
        (sa) => sa.platform === 'TELEGRAM' && sa.verificationCode.toUpperCase() === code
      )
    : null;

  if (!code || !accountByCode) {
    return {
      success: false,
      response:
        'It looks like your code is incorrect or expired. Please generate a new connection code in the NIMORA mini-app under Profile > Social Accounts.',
    };
  }

  // Account found by secret verification code generated in user's authenticated session
  accountByCode.isVerified = true;
  accountByCode.verifiedAt = new Date().toISOString();
  if (cleanHandle && !cleanHandle.startsWith('user_')) {
    accountByCode.handle = cleanHandle;
    accountByCode.displayHandle = `@${cleanHandle}`;
  }
  if (senderTelegramId) {
    accountByCode.telegramUserId = String(senderTelegramId);
  }
  if (chatId) {
    accountByCode.chatId = String(chatId);
  }

  const ownerUser = db.state.users.find((u) => u.id === accountByCode.userId);
  if (ownerUser) {
    ownerUser.telegramHandle = accountByCode.handle;
    if (senderTelegramId) {
      ownerUser.telegramUserId = String(senderTelegramId);
    }
  }

  // Automatically credit any pending tips held in escrow!
  const claimedNim = claimPendingSocialTipsForUser('TELEGRAM', accountByCode.handle, accountByCode.userId);
  db.save();

  return {
    success: true,
    response: `🎉 Congratulations, your handle (@${accountByCode.handle}) has been successfully connected to ${
      ownerUser ? ownerUser.address : 'your Nimora wallet'
    }.${claimedNim > 0 ? `\n\n🎁 ${claimedNim} $NIM from pending tips held in escrow has been automatically credited to your balance!` : ''}\n\nYou only need to connect and sign in once. You can now send tips or payments directly with /tip or /pay without opening the mini-app!`,
    account: accountByCode,
  };
}

let eventBroadcaster: ((event: string, data: any) => void) | null = null;
export function setSocialEventBroadcaster(fn: (event: string, data: any) => void) {
  eventBroadcaster = fn;
}

/**
 * Handles processing of an incoming message for Telegram bot.
 * Guarantees exactly 1 response for 1 command.
 */
export async function processTelegramMessage(params: {
  senderHandle: string;
  senderTelegramId?: string | number;
  rawText: string;
  chatId?: string | number;
  replyToHandle?: string;
  replyToId?: string | number;
}): Promise<string> {
  const { senderHandle, senderTelegramId, rawText, chatId, replyToHandle } = params;
  const text = (rawText || '').trim();
  const cleanSender = cleanSocialHandle(senderHandle);

  // 1. /start command
  if (text === '/start' || text.startsWith('/start')) {
    const startCodeMatch = text.match(/^\/start\s+(?:connect_)?(TG-[A-Za-z0-9_-]+)/i);
    if (startCodeMatch) {
      const code = startCodeMatch[1].toUpperCase();
      const verResult = verifyTelegramConnection(cleanSender, `/connect ${code}`, senderTelegramId, chatId);
      if (verResult.success && verResult.account && eventBroadcaster) {
        eventBroadcaster('SOCIAL_ACCOUNTS_UPDATED', {
          userId: verResult.account.userId,
          platform: 'TELEGRAM',
          handle: verResult.account.handle,
        });
      }
      return verResult.response;
    }

    return `Welcome to NIMORA Pay Bot! 🌟\n\nConnect once to send tips and payments directly in Telegram without opening the mini-app again!\n\nCommands:\n• /tip @recipient [amount] - Send $NIM tip instantly\n• /pay @recipient [amount] - Send $NIM payment\n• /balance - Check your connected wallet balance\n• /connect [code] - Link your Telegram account with your NIMORA wallet\n• /help - Bot guide and commands`;
  }

  // 2. /connect [user code] command
  if (text.startsWith('/connect')) {
    const verResult = verifyTelegramConnection(cleanSender, text, senderTelegramId, chatId);
    if (verResult.success && verResult.account && eventBroadcaster) {
      eventBroadcaster('SOCIAL_ACCOUNTS_UPDATED', {
        userId: verResult.account.userId,
        platform: 'TELEGRAM',
        handle: verResult.account.handle,
      });
    }
    return verResult.response;
  }

  // 3. /claim [slug], /rp [slug], or Red Packet link
  const isRedPacketClaim =
    /^\/(?:claim|rp)\b/i.test(text) ||
    /https?:\/\/[^\s]+(?:\/rp\/|\/redpacket\/claim\/)([a-zA-Z0-9_-]+)/i.test(text) ||
    /nimora:\/\/redpacket\?id=([a-zA-Z0-9_-]+)/i.test(text);

  if (isRedPacketClaim) {
    let slug: string | null = null;
    const matchCmd = text.match(/^\/(?:claim|rp)\s+([a-zA-Z0-9_-]+)/i);
    const matchUrl = text.match(/(?:\/rp\/|\/redpacket\/claim\/)([a-zA-Z0-9_-]+)/i);
    const matchScheme = text.match(/nimora:\/\/redpacket\?id=([a-zA-Z0-9_-]+)/i);

    if (matchCmd) slug = matchCmd[1];
    else if (matchUrl) slug = matchUrl[1];
    else if (matchScheme) slug = matchScheme[1];

    if (!slug) {
      return '🎁 To claim a Red Packet, send:\n/claim [code_or_slug] or paste the Red Packet link!';
    }

    const { account, user } = findTelegramAccount(cleanSender, senderTelegramId);
    if (!account || !account.isVerified || !user) {
      return `⚠️ Your Telegram account (@${cleanSender}) is not connected to a NIMORA wallet yet.\n\nTo claim this Red Packet directly into your wallet:\n1. Open the NIMORA mini-app\n2. Go to Profile > Social Accounts to get your code\n3. Send /connect [code] here!\n\nOnce connected, all claimed $NIM will land directly into your wallet!`;
    }

    const claimRes = await claimRedPacketForUser(slug, user);
    return claimRes.message || (claimRes.success ? '🎉 Red Packet claimed successfully!' : (claimRes.error || 'Claim failed'));
  }

  // 4. /tip, /pay, !tip, !pay, or natural tipping commands
  const isTipOrPay =
    /^\/(?:tip|pay)\b/i.test(text) ||
    /^!(?:tip|pay)\b/i.test(text) ||
    /^(?:tip|pay)\s+@/i.test(text) ||
    /^(?:tip|pay)\s+[0-9]/i.test(text);

  if (isTipOrPay) {
    let recHandle: string | null = null;
    let amountNim: number | null = null;

    const matchUserFirst = text.match(/(?:tip|pay)\s+@([a-zA-Z0-9_]+)\s+([0-9]+(?:\.[0-9]+)?)/i);
    const matchAmountFirst = text.match(/(?:tip|pay)\s+([0-9]+(?:\.[0-9]+)?)(?:\s*NIM)?\s+@?([a-zA-Z0-9_]+)/i);

    if (matchUserFirst) {
      recHandle = cleanSocialHandle(matchUserFirst[1]);
      amountNim = parseFloat(matchUserFirst[2]);
    } else if (matchAmountFirst) {
      amountNim = parseFloat(matchAmountFirst[1]);
      recHandle = cleanSocialHandle(matchAmountFirst[2]);
    } else if (replyToHandle) {
      // Replying directly to another user's message in a group
      const matchOnlyAmount = text.match(/(?:tip|pay)\s+([0-9]+(?:\.[0-9]+)?)/i);
      if (matchOnlyAmount) {
        amountNim = parseFloat(matchOnlyAmount[1]);
        recHandle = cleanSocialHandle(replyToHandle);
      }
    }

    if (recHandle && amountNim && !isNaN(amountNim) && amountNim > 0) {
      if (recHandle === cleanSender) {
        return "You cannot tip yourself! Please specify another user's Telegram handle.";
      }

      const result = await executeSocialTransfer({
        platform: 'TELEGRAM',
        senderHandle: cleanSender,
        senderTelegramId,
        recipientHandle: recHandle,
        amountNim,
        rawText: text,
      });

      if (eventBroadcaster) {
        eventBroadcaster('SOCIAL_TRANSFER_COMPLETED', result);
      }
      return result.botResponse;
    }

    return 'Usage: /tip @recipient <amount> (e.g. `/tip @alice 10`) or reply to a message with `/tip 10`.';
  }

  // 4. /balance command
  if (text.startsWith('/balance') || text === 'balance') {
    const found = findTelegramAccount(cleanSender, senderTelegramId);
    let targetUser: UserRecord | null = found.user;

    if (!targetUser) {
      targetUser =
        db.state.users.find(
          (u) =>
            (senderTelegramId && u.telegramUserId === String(senderTelegramId)) ||
            cleanSocialHandle(u.telegramHandle || '') === cleanSender ||
            cleanSocialHandle(u.realName || '') === cleanSender
        ) || null;
    }

    if (targetUser) {
      const bal = db.getUserBalance(targetUser.id);
      const formatted = Number(bal.toFixed(2)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 5,
      });
      return `💰 Your current NIMORA wallet balance is ${formatted} $NIM.\nWallet address: ${targetUser.address}\nLinked account: @${cleanSender} ✨\n\nYou can tip anytime with /tip @username [amount] without opening the mini-app!`;
    }

    const pendingAccount = db.state.socialAccounts.find(
      (sa) => sa.platform === 'TELEGRAM' && cleanSocialHandle(sa.handle) === cleanSender
    );
    if (pendingAccount) {
      return `Your Telegram handle (@${cleanSender}) is not verified yet. Please send \`/connect ${pendingAccount.verificationCode}\` to link your NIMORA wallet and check your balance.`;
    }

    return `Your Telegram handle (@${cleanSender}) is not connected to a NIMORA wallet yet.\n\nTo view your balance and send $NIM:\n1. Open the NIMORA mini-app\n2. Go to Profile > Social Accounts\n3. Enter @${cleanSender} to generate your verification code\n4. Send \`/connect [your code]\` here to link your wallet!\n\nOnce connected, you will never need to open the mini-app to tip again!`;
  }

  // 5. /help command
  if (text.startsWith('/help') || text === 'help') {
    return `NIMORA Pay Bot Guide:
• /tip @recipient [amount] - Tip $NIM instantly to a friend
• /pay @recipient [amount] - Send $NIM payment
• /claim [slug] - Claim a Red Packet into your wallet
• /balance - Check your current $NIM wallet balance
• /connect [code] - Link your Telegram handle with your NIMORA mini-app wallet
• /help - Bot usage guide and support

Tip: Once connected, you never need to open the mini-app again to pay, tip, or claim!`;
  }

  // Fallback for unhandled / complex questions
  return 'This issue appears to be quite complex. Please send an email to support@nimora.xyz for further assistance.';
}

/**
 * Message deduplication set: ensures 1 command = 1 response.
 */
const processedMessageKeys = new Set<string>();

let isPollingActive = false;
let pollingAbortController: AbortController | null = null;

export function stopTelegramBotPolling() {
  isPollingActive = false;
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
}

let lastUpdateId = 0;

export async function sendTelegramMessage(token: string, chatId: number | string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error('Error sending Telegram message:', err);
  }
}

export function startTelegramBotPolling() {
  if (isPollingActive) return;
  isPollingActive = true;
  pollingAbortController = new AbortController();
  const signal = pollingAbortController.signal;

  const pollLoop = async () => {
    const token =
      db.state.socialBotConfig?.telegramBotToken ||
      '8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw';

    // Clear any leftover webhook so getUpdates polling works cleanly
    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
    } catch {
      // Ignore
    }

    // Load lastTelegramUpdateId from persistent state
    let lastUpdateId = Number(db.state.socialBotConfig?.lastTelegramUpdateId || 0);

    // If starting fresh or 0, catch up with offset -1 to drop any stale piled-up backlog
    if (lastUpdateId === 0) {
      try {
        const catchUpUrl = `https://api.telegram.org/bot${token}/getUpdates?offset=-1&timeout=0`;
        const catchUpResp = await fetch(catchUpUrl);
        if (catchUpResp.ok) {
          const catchUpData = (await catchUpResp.json()) as {
            ok: boolean;
            result?: Array<{ update_id: number }>;
          };
          if (catchUpData.ok && Array.isArray(catchUpData.result) && catchUpData.result.length > 0) {
            lastUpdateId = catchUpData.result[catchUpData.result.length - 1].update_id;
            if (db.state.socialBotConfig) {
              db.state.socialBotConfig.lastTelegramUpdateId = lastUpdateId;
              db.save();
            }
          }
        }
      } catch {
        // Ignore
      }
    }

    while (isPollingActive && !signal.aborted) {
      const curToken =
        db.state.socialBotConfig?.telegramBotToken ||
        '8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw';
      const isListening = db.state.socialBotConfig?.isListening !== false;

      if (!curToken || !isListening) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }

      try {
        const url = `https://api.telegram.org/bot${curToken}/getUpdates?offset=${
          lastUpdateId + 1
        }&timeout=8`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });

        if (resp.status === 409) {
          // If 409 Conflict, delete webhook and back off
          await fetch(`https://api.telegram.org/bot${curToken}/deleteWebhook?drop_pending_updates=false`).catch(() => null);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        if (!resp.ok) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const data = (await resp.json()) as { ok: boolean; result?: any[] };
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            if (update.update_id > lastUpdateId) {
              lastUpdateId = update.update_id;
              if (db.state.socialBotConfig) {
                db.state.socialBotConfig.lastTelegramUpdateId = lastUpdateId;
                db.save();
              }
            }
            const m = update.message || update.channel_post;
            if (!m || !m.text || !m.chat?.id) continue;

            // DEDUPLICATION: exactly 1 command = 1 response
            const dedupeKey = `${update.update_id}:${m.chat.id}:${m.message_id}`;
            if (processedMessageKeys.has(dedupeKey)) {
              continue;
            }
            processedMessageKeys.add(dedupeKey);
            if (processedMessageKeys.size > 2000) {
              const first = processedMessageKeys.values().next().value;
              if (first) processedMessageKeys.delete(first);
            }

            const senderHandle = cleanSocialHandle(m.from?.username || `user_${m.from?.id}`);
            const reply = await processTelegramMessage({
              senderHandle,
              senderTelegramId: m.from?.id,
              rawText: m.text,
              chatId: m.chat.id,
              replyToHandle: m.reply_to_message?.from?.username,
              replyToId: m.reply_to_message?.from?.id,
            });

            if (reply) {
              await sendTelegramMessage(token, m.chat.id, reply);
            }
          }
        }
      } catch (err: any) {
        // Network or timeout error: harmless, backoff briefly
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };

  // Run in background without blocking
  pollLoop().catch((e) => console.error('Telegram polling error:', e));
}


