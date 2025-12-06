import TelegramBot from 'node-telegram-bot-api';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;

if (!botToken) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!webhookUrl) {
  console.error('Error: WEBHOOK_URL environment variable is required');
  process.exit(1);
}

async function setupWebhook() {
  try {
    const bot = new TelegramBot(botToken);
    const secretToken = process.env.WEBHOOK_SECRET_TOKEN;
    
    // Set webhook with secret token
    await bot.setWebHook(`${webhookUrl}/api/webhook`, {
      secret_token: secretToken,
    });
    
    const webhookInfo = await bot.getWebHookInfo();
    console.log('Webhook set successfully!');
    console.log('Webhook URL:', webhookInfo.url);
    console.log('Pending updates:', webhookInfo.pending_update_count);
    if (secretToken) {
      console.log('✅ Secret token configured');
    } else {
      console.warn('⚠️  No secret token set - webhook is not secured!');
    }
  } catch (error) {
    console.error('Error setting webhook:', error);
    process.exit(1);
  }
}

setupWebhook();

