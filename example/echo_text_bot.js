/*
 * Wire
 * Copyright (C) 2017 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

const path = require('path');

const service = require('../lib/service');

// a simple echo bot which sends back text messages it receives

service.createService({
  port: 443,
  key: 'server.key',
  cert: 'server.crt',
  storePath: path.join(__dirname, 'store'),
  auth: '<put your auth token here>',
}, (bot) => {
  console.log(`Bot instance created ${bot.botID}`);
  bot.on('message', (from, message) => {
    console.log(`Got message from ${from} text: ${message.text}`);
    bot.sendMessage(message.text.content, (sendStatus) => {
      console.log(`message successfully sent with status ${sendStatus}`);
    });
  });
  bot.on('join', (members, conversation) => {
    console.log(`New members ${members} joined conversation ${conversation.id}`);
  });
  bot.on('leave', (members, conversation) => {
    console.log(`Members ${members} have left conversation ${conversation.id}`);
  });
  bot.on('rename', (name, conversation) => {
    console.log(`Conversation ${conversation.id} renamed to ${name}`);
  });
});
