// api/telegram-webhook.js
export const config = { runtime: 'edge' };

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;             // e.g. "7557313062" or "-100…"
const WEBHOOK_SECRET_TOKEN = process.env.WEBHOOK_SECRET_TOKEN; // e.g. "lola2"

const tg = async (method, body) => {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  // TG log
  console.log(`[TG] ${method} status=${resp.status} ok=${resp.ok} body=${text}`);
  return { ok: resp.ok, status: resp.status, text };
};

const updateHWIDStatus = async (hwid, status) => {
  const url = `${SUPABASE_URL}/rest/v1/hwid_approvals?hwid=eq.${encodeURIComponent(hwid)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ status }),
  });
  const text = await resp.text().catch(() => '');
  console.log(`[SB] PATCH status=${resp.status} ok=${resp.ok} body=${text || '<empty>'}`);
  if (!resp.ok) throw new Error(`Supabase PATCH ${resp.status} ${text}`);
};

const pickHWID = (s) => (s && (s.match(/[A-Fa-f0-9]{64}/) || [])[0]) || null;
const asStr = (v) => (typeof v === 'number' ? String(v) : (v || ''));

export default async function handler(req) {
  // GET -> health + optional ping to admin
  if (req.method !== 'POST') {
    try {
      console.log('[PING] GET health check');
      if (BOT_TOKEN && ADMIN_CHAT_ID) {
        await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, text: 'Webhook alive ✅' });
      }
    } catch (e) {
      console.log('[PING][ERR]', e?.message || String(e));
    }
    return new Response('OK', { status: 200 });
  }

  // Secret header check
  if (WEBHOOK_SECRET_TOKEN) {
    const got = req.headers.get('x-telegram-bot-api-secret-token');
    if (got !== WEBHOOK_SECRET_TOKEN) {
      console.log('[SEC] secret mismatch, ignoring');
      return new Response('OK', { status: 200 });
    }
  }

  try {
    const update = await req.json();
    // UPD log (trim long payloads if needed)
    console.log('[UPD]', JSON.stringify(update));

    // Callback buttons
    if (update?.callback_query) {
      const cq = update.callback_query;
      const chatIdStr = asStr(cq?.message?.chat?.id);
      console.log(`[UPD] callback_query chatId=${chatIdStr} data=${cq?.data}`);
      if (ADMIN_CHAT_ID && chatIdStr !== ADMIN_CHAT_ID) {
        console.log('[AUTH] not admin chat, ignoring');
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Not authorized' });
        return new Response('OK', { status: 200 });
      }

      const [action, hwid] = String(cq.data || '').split(':');
      const map = { approve: 'approved', reject: 'rejected', hold: 'hold' };
      const status = map[action];
      console.log(`[FLOW] action=${action} -> status=${status} hwid=${hwid?.slice(0,12)}…`);

      if (!status || !hwid) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Invalid action' });
        return new Response('OK', { status: 200 });
      }

      await updateHWIDStatus(hwid, status);
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `HWID ${status}` });
      const emoji = { approved: '✅', rejected: '❌', hold: '⏸️' }[status];
      await tg('editMessageText', {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: `${emoji} HWID ${status.toUpperCase()}\n\nHWID: ${hwid}\n\nUpdated at ${new Date().toISOString()}`,
      });
      return new Response('OK', { status: 200 });
    }

    // Text commands: /approve|/reject|/hold [HWID] or reply to HWID message
    if (typeof update?.message?.text === 'string') {
      const msg = update.message;
      const chatIdStr = asStr(msg?.chat?.id);
      console.log(`[UPD] message chatId=${chatIdStr} text=${JSON.stringify(msg.text)}`);
      if (ADMIN_CHAT_ID && chatIdStr !== ADMIN_CHAT_ID) {
        console.log('[AUTH] not admin chat, ignoring');
        return new Response('OK', { status: 200 });
      }

      const text = msg.text.trim();
      const m = text.match(/^\/(approve|reject|hold)(?:\s+([A-Fa-f0-9]{64}))?$/i);
      if (m) {
        const action = m[1].toLowerCase();
        let hwid = m[2] || null;
        if (!hwid && msg.reply_to_message?.text) hwid = pickHWID(msg.reply_to_message.text);
        console.log(`[FLOW] cmd=${action} hwid=${hwid?.slice(0,12)}…`);

        if (!hwid) {
          await tg('sendMessage', { chat_id: msg.chat.id, text: '❌ Missing HWID. Reply to the HWID message with /approve or include the HWID.' });
        } else {
          const map = { approve: 'approved', reject: 'rejected', hold: 'hold' };
          await updateHWIDStatus(hwid, map[action]);
          await tg('sendMessage', { chat_id: msg.chat.id, text: `✅ Status updated to ${map[action].toUpperCase()} for HWID ${hwid}` });
        }
        return new Response('OK', { status: 200 });
      }
    }

    return new Response('OK', { status: 200 });
  } catch (e) {
    console.log('[ERR]', e?.message || String(e));
    return new Response('OK', { status: 200 });
  }
}