import { createChatBotMessage } from 'react-chatbot-kit';

const config = {
  initialMessages: [
    createChatBotMessage(
      `👋 Welcome to FinovatePay! I'm here to help you with:\n\n` +
      `💸 Payments & Escrow\n` +
      `🧾 Invoice Management\n` +
      `⚖️ Dispute Resolution\n` +
      `📦 Shipment Tracking\n\n` +
      `How can I assist you today?`
    )
  ],
  botName: 'FinovateBot',
};

export default config;