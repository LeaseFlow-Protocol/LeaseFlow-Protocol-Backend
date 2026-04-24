const { Server } = require('socket.io');
const chatService = require('../services/chat.service');

let io;

function initChatGateway(server) {
  io = new Server(server, { path: '/ws/chat' });

  io.on('connection', (socket) => {
    socket.on('send_message', async ({ senderId, receiverId, content }) => {
      const message = await chatService.sendMessage(senderId, receiverId, content);
      io.to(receiverId).emit('new_message', message);
      io.to(senderId).emit('message_sent', message);
    });
  });
}

module.exports = { initChatGateway };
