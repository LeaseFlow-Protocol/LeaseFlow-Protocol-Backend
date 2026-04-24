const db = require('../db');
const crypto = require('crypto');

class ChatService {
  async sendMessage(senderId, receiverId, content) {
    const hash = crypto.createHash('sha256').update(content + Date.now()).digest('hex');

    const [message] = await db('chat_messages')
      .insert({
        senderId,
        receiverId,
        content,
        hash,
        createdAt: new Date()
      })
      .returning('*');

    return message;
  }

  async listMessages(userId, otherPartyId) {
    return db('chat_messages')
      .where(function () {
        this.where({ senderId: userId, receiverId: otherPartyId })
            .orWhere({ senderId: otherPartyId, receiverId: userId });
      })
      .orderBy('createdAt', 'asc');
  }
}

module.exports = new ChatService();
