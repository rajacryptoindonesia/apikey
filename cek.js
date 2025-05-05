const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Environment variables or config
const BOT_TOKEN = process.env.BOT_TOKEN || '7640956324:AAGyRuhXb8bi8wuHwSEOAFOaxyA-L45p7aw';
const AUTHORIZED_USERS = process.env.AUTHORIZED_USERS ? process.env.AUTHORIZED_USERS.split(',') : ['6456655262'];

// Create a bot instance (polling mode)
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Check if user is authorized
function isAuthorized(userId) {
  userId = userId.toString();
  if (!AUTHORIZED_USERS.includes(userId)) {
    return false;
  }
  return true;
}

// Load servers from the servers.json file
function loadServers() {
  try {
    const serversPath = path.join(__dirname, 'servers.json');
    const serversData = fs.readFileSync(serversPath, 'utf8');
    return JSON.parse(serversData);
  } catch (error) {
    console.error(`Error loading servers.json: ${error.message}`);
    return [];
  }
}

// Check server status
async function checkServersStatus() {
  const servers = loadServers();
  if (servers.length === 0) {
    return '⚠️ No servers found in servers.json';
  }

  const statusPromises = servers.map(server => {
    return axios.get(`${server.host}/status`, { timeout: 5000 })
      .then(response => {
        return {
          name: server.name,
          host: server.host,
          online: true,
          data: response.data
        };
      })
      .catch(() => {
        return {
          name: server.name,
          host: server.host,
          online: false
        };
      });
  });

  try {
    const results = await Promise.all(statusPromises);

    let statusMessage = '📊 *SERVER STATUS*\n\n';
    let onlineCount = 0;

    results.forEach(result => {
      if (result.online) {
        statusMessage += `✅ *${result.name}* (@mrtanjirox)\n`;
        onlineCount++;
      } else {
        statusMessage += `❌ *${result.name}* (@mrtanjirox)\n`;
      }
    });

    statusMessage += `\n*${onlineCount}* of *${servers.length}* servers online`;
    
    return statusMessage;
  } catch (error) {
    return `⚠️ Error checking server status: ${error.message}`;
  }
}

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAuthorized(msg.from.id)) {
    bot.sendMessage(chatId, '⛔ You are not authorized to use this bot.\nContact @mistertanjiro to claim access bot');
    return;
  }
  
  bot.sendMessage(
    chatId,
    `👋 Welcome to *MrTanjiro Status Bot*!\n\n` +
    `Commands:\n` +
    `/check - Check server status`,
    { parse_mode: 'Markdown' }
  );
});

// Handle /check command
bot.onText(/\/check/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAuthorized(msg.from.id)) {
    bot.sendMessage(chatId, '⛔ You are not authorized to use this bot.\nContact @mistertanjiro to claim access bot');
    return;
  }
  
  const loadingMsg = await bot.sendMessage(chatId, '🔍 Checking server status...');
  const statusMsg = await checkServersStatus();
  
  bot.editMessageText(statusMsg, {
    chat_id: chatId,
    message_id: loadingMsg.message_id,
    parse_mode: 'Markdown'
  }).catch(error => {
    console.error('Failed to edit message:', error);
    bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
  });
});

// Handle any other message
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  
  // Ignore commands we already handle
  if (text.startsWith('/start') || text.startsWith('/check')) {
    return;
  }
  
  if (!isAuthorized(msg.from.id)) {
    bot.sendMessage(chatId, '⛔ You are not authorized to use this bot.\nContact @mistertanjiro to claim access bot');
    return;
  }
  
  bot.sendMessage(
    chatId, 
    'Use /check to check server status', 
    { parse_mode: 'Markdown' }
  );
});

// Start the bot
console.log('MrTanjiro Status Bot is running...');

// Handle bot stopping
process.once('SIGINT', () => {
  bot.stopPolling();
  console.log('Status bot shutting down...');
  process.exit(0);
});

process.once('SIGTERM', () => {
  bot.stopPolling();
  console.log('Status bot shutting down...');
  process.exit(0);
});
