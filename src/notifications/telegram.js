import { config } from '../config.js';

const TELEGRAM_API_URL = 'https://api.telegram.org/bot';

class TelegramNotifier {
  constructor() {
    this.botToken = config.telegram?.botToken || '';
    this.chatId = config.telegram?.chatId || '';
    this.enabled = !!(this.botToken && this.chatId);
  }

  async sendMessage(text, parseMode = 'HTML') {
    if (!this.enabled) {
      console.log('[Telegram] Not configured, skipping:', text.substring(0, 50));
      return;
    }

    try {
      const url = `${TELEGRAM_API_URL}${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Telegram] Send failed:', error);
      }
    } catch (err) {
      console.error('[Telegram] Error:', err.message);
    }
  }

  async notifySignal(symbol, signal, confidence, reason, price) {
    const emoji = signal === 'LONG' ? '🟢' : signal === 'SHORT' ? '🔴' : '⚪';
    const text = `
${emoji} <b>Signal Detected</b>

Symbol: <code>${symbol}</code>
Signal: <b>${signal}</b>
Confidence: ${(confidence * 100).toFixed(1)}%
Price: $${price?.toFixed(4) || 'N/A'}
Reason: ${reason || 'N/A'}
    `.trim();
    await this.sendMessage(text);
  }

  async notifyOrderPlaced(symbol, side, type, price, vol, leverage, orderId) {
    const emoji = side.includes('LONG') ? '📈' : '📉';
    const text = `
${emoji} <b>Order Placed</b>

Symbol: <code>${symbol}</code>
Side: <b>${side}</b>
Type: ${type}
Price: $${price?.toFixed(4) || 'MARKET'}
Volume: ${vol}
Leverage: ${leverage}x
Order ID: <code>${orderId || 'N/A'}</code>
    `.trim();
    await this.sendMessage(text);
  }

  async notifyOrderFilled(symbol, side, price, vol, pnl) {
    const emoji = side.includes('LONG') ? '✅' : '✅';
    const text = `
${emoji} <b>Order Filled</b>

Symbol: <code>${symbol}</code>
Side: <b>${side}</b>
Price: $${price?.toFixed(4)}
Volume: ${vol}
${pnl !== undefined ? `PnL: $${pnl.toFixed(2)}` : ''}
    `.trim();
    await this.sendMessage(text);
  }

  async notifyOrderCancelled(symbol, orderId, reason) {
    const text = `
❌ <b>Order Cancelled</b>

Symbol: <code>${symbol}</code>
Order ID: <code>${orderId || 'N/A'}</code>
Reason: ${reason || 'N/A'}
    `.trim();
    await this.sendMessage(text);
  }

  async notifyError(error, context = '') {
    const text = `
⚠️ <b>Error Occurred</b>

Context: ${context || 'Unknown'}
Error: <code>${error?.message || String(error)}</code>
    `.trim();
    await this.sendMessage(text);
  }

  async notifyPositionOpened(symbol, side, entryPrice, vol, leverage) {
    const emoji = side.includes('LONG') ? '📊' : '📊';
    const text = `
${emoji} <b>Position Opened</b>

Symbol: <code>${symbol}</code>
Side: <b>${side}</b>
Entry Price: $${entryPrice?.toFixed(4)}
Volume: ${vol}
Leverage: ${leverage}x
    `.trim();
    await this.sendMessage(text);
  }

  async notifyPositionClosed(symbol, side, entryPrice, exitPrice, pnl, pnlPct, reason = '') {
    const emoji = pnl >= 0 ? '💰' : '💸';
    const reasonText = reason ? `\nReason: <b>${reason}</b>` : '';
    const text = `
${emoji} <b>Position Closed</b>

Symbol: <code>${symbol}</code>
Side: <b>${side}</b>
Entry: $${entryPrice?.toFixed(4)}
Exit: $${exitPrice?.toFixed(4)}
PnL: $${pnl?.toFixed(2)} (${pnlPct?.toFixed(2)}%)${reasonText}
    `.trim();
    await this.sendMessage(text);
  }

  async notifyBotStatus(status, message = '') {
    const emoji = status === 'started' ? '🚀' : status === 'stopped' ? '🛑' : 'ℹ️';
    const text = `
${emoji} <b>Bot Status: ${status.toUpperCase()}</b>

${message || ''}
    `.trim();
    await this.sendMessage(text);
  }
}

export const telegram = new TelegramNotifier();
