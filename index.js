const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const express = require('express');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const path = require('path');


// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


const app = express();
const server = http.createServer(app); // Create HTTP server
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity; change in production
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(cors());

// Sample route to send verification email
app.post('/send-verification-email', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().generateEmailVerificationLink(user.email);
    res.status(200).send('Verification email sent.');
  } catch (error) {
    res.status(400).send(error.message);
  }
});


// Store active user connections
const userSockets = {};

io.on('connection', (socket) => {
  console.log('New client connected');

  // User joins and registers their socket
  socket.on('register_user', (userId) => {
    userSockets[userId] = socket.id;
    console.log(`User ${userId} registered`);
  });

  // Send private message
  socket.on('send_private_message', async (messageData) => {
    try {
      const { senderId, receiverId, text, imageUrl } = messageData;
      
      // Generate unique chat room ID
      const chatRoomId = [senderId, receiverId].sort().join('_');

      // Save message to Firestore
      const db = admin.firestore();
      await db.collection('private_messages')
        .doc(chatRoomId)
        .collection('messages')
        .add({
          senderId,
          receiverId,
          text: text || '',
          imageUrl: imageUrl || null,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          read: false
        });

      // Broadcast to receiver if online
      const receiverSocketId = userSockets[receiverId];
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_private_message', {
          ...messageData,
          chatRoomId
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  // Upload image to Cloudinary
  socket.on('upload_image', async (imageData, callback) => {
    try {
      const uploadResult = await cloudinary.uploader.upload(imageData, {
        folder: 'chat_images',
        unique_filename: true
      });

      callback({
        success: true,
        imageUrl: uploadResult.secure_url
      });
    } catch (error) {
      console.error('Image upload error:', error);
      callback({
        success: false,
        error: 'Image upload failed'
      });
    }
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    // Remove user from active sockets
    for (let userId in userSockets) {
      if (userSockets[userId] === socket.id) {
        delete userSockets[userId];
        break;
      }
    }
    console.log('Client disconnected');
  });
});


// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
