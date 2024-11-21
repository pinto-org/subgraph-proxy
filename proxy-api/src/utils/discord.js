require('dotenv').config();
const axios = require('axios');

const MIN_MESSAGE_FREQUENCY = 120 * 1000;

class DiscordUtil {
  // Mitigates against message spam
  static lastMessageTime;

  // Sends a discord webhook message if any channels are configured here
  static async sendWebhookMessage(message, priority = false) {
    if (!priority && this.lastMessageTime && new Date() - this.lastMessageTime < MIN_MESSAGE_FREQUENCY) {
      // Ignore this message, but log in server
      console.log(
        `[DiscordUtil] Attempted to send a message, but too many messages have been sent recently:\n ==> ${message}`
      );
      return;
    }

    this.lastMessageTime = new Date();

    const webhookUrls = process.env.DISCORD_NOTIFICATION_WEBHOOKS?.split(',');
    if (webhookUrls) {
      let prefix = process.env.DISCORD_NOTIFICATION_PREFIX ? process.env.DISCORD_NOTIFICATION_PREFIX + '\n' : '';
      await Promise.all(
        webhookUrls.map(async (url) => {
          await axios.post(url, {
            // avatar_url: '',
            username: 'Subgraph Proxy',
            content: `${prefix}[${process.env.NODE_ENV}] - ${message}`
          });
        })
      );
    }
  }
}

module.exports = DiscordUtil;
