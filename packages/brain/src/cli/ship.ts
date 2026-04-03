import { printSuccess, printError, c } from './banner';

export async function runShip(rawMessage: string): Promise<void> {
  if (!rawMessage || rawMessage.trim().length === 0) {
    printError(`Usage: npx clude-bot ship "your message"`);
    process.exit(1);
  }

  // Lazy-load config + telegram client to keep CLI lightweight
  const { config } = require('@clude/shared/config');

  if (!config.telegram.botToken) {
    printError('TELEGRAM_BOT_TOKEN not set. Add it to .env');
    process.exit(1);
  }
  if (!config.telegram.channelId) {
    printError('TELEGRAM_CHANNEL_ID not set. Add it to .env');
    process.exit(1);
  }

  const message = rawMessage.trim();
  console.log(`\n  ${c.dim}Sending to ${config.telegram.channelId}...${c.reset}\n`);

  const { sendChannelMessage } = require('@clude/shared/core/telegram-client');

  try {
    const result = await sendChannelMessage(message, { parseMode: 'HTML', disablePreview: true });
    printSuccess(`Message sent! (ID: ${result.messageId})`);
  } catch (err) {
    printError(`Failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
