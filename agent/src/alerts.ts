/**
 * Alert service for sending notifications via Telegram.
 * Supports multiple severity levels and rate limiting.
 */
export class AlertService {
  private botToken: string;
  private chatId: string;
  private lastAlertTime: number = 0;
  private minAlertIntervalMs: number = 10000; // 10s between alerts

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async sendAlert(severity: string, message: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertTime < this.minAlertIntervalMs) {
      console.log(`[Alert rate-limited] ${severity}: ${message}`);
      return;
    }
    this.lastAlertTime = now;

    const emoji = this.getSeverityEmoji(severity);
    const formatted = `${emoji} *Fold Alert - ${severity}*\n\n${message}\n\n_Privacy preserved via Arcium MPC_`;

    // Log to console always
    console.log(`\n${"!".repeat(50)}`);
    console.log(`ALERT [${severity}]: ${message}`);
    console.log(`${"!".repeat(50)}\n`);

    // Send to Telegram if configured
    if (this.botToken && this.chatId) {
      try {
        const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: formatted,
            parse_mode: "Markdown",
          }),
        });

        if (!response.ok) {
          console.error("Telegram send failed:", await response.text());
        } else {
          console.log("Telegram alert sent successfully");
        }
      } catch (err) {
        console.error("Failed to send Telegram alert:", err);
      }
    }
  }

  private getSeverityEmoji(severity: string): string {
    switch (severity.toUpperCase()) {
      case "CRITICAL": return "\u{1F6A8}";
      case "ACTION": return "\u{26A1}";
      case "WARNING": return "\u{26A0}\u{FE0F}";
      case "INFO": return "\u{2139}\u{FE0F}";
      default: return "\u{1F514}";
    }
  }
}
