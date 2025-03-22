// index.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { BlobServiceClient } = require('@azure/storage-blob');

const app = express();
const port = process.env.PORT || 3000;

// Configure Multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Azure Blob Storage Setup
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'photos';
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(containerName);

// Create container if it doesn't exist
async function createContainerIfNotExists() {
  const exists = await containerClient.exists();
  if (!exists) {
    await containerClient.create();
    console.log(`Container "${containerName}" created.`);
  } else {
    console.log(`Container "${containerName}" exists.`);
  }
}
createContainerIfNotExists();

// Set EJS as the view engine
app.set('view engine', 'ejs');

// Dummy authentication middleware for demonstration.
// In a real app, use a proper authentication system.
app.use((req, res, next) => {
  // Simulating a user with a role.
  req.user = { username: 'demo', role: 'admin' }; // Change to 'user' for testing user access
  next();
});

// Middleware for role-based access (Admin only)
function ensureAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).send('Access denied.');
}

// Route: Home – Display the photo gallery
app.get('/', async (req, res) => {
  let blobs = [];
  try {
    // List all blobs in the container
    for await (const blob of containerClient.listBlobsFlat()) {
      blobs.push(blob.name);
    }
    res.render('gallery', { images: blobs, user: req.user });
  } catch (err) {
    console.error('Error listing blobs:', err);
    res.status(500).send('Error retrieving images.');
  }
});

// Route: GET Upload form
app.get('/upload', (req, res) => {
  res.render('upload');
});

// Route: POST Image Upload (Admin only)
app.post('/upload', ensureAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }
  try {
    // Create a unique name for the blob using timestamp
    const blobName = Date.now() + path.extname(req.file.originalname);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(req.file.buffer);
    res.redirect('/');
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).send('Error uploading image.');
  }
});

// Route: POST Delete image (Admin-only)
app.post('/delete/:blobName', ensureAdmin, async (req, res) => {
  const blobName = req.params.blobName;
  try {
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.delete();
    res.redirect('/');
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).send('Error deleting image.');
  }
});

// Basic error handler middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Internal Server Error');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
