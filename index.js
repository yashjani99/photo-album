require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { BlobServiceClient } = require('@azure/storage-blob');
const session = require('express-session');
const bodyParser = require('body-parser');

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
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Set up session middleware
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: true
}));

// Dummy authentication middleware for demonstration
app.use((req, res, next) => {
  if (!req.session.user) {
    req.session.user = { username: 'guest', role: 'user' }; // Simulate logged-out state
  }
  next();
});

// Middleware for role-based access (Admin only)
function ensureAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
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
    res.render('gallery', { images: blobs, user: req.session.user });
  } catch (err) {
    console.error('Error listing blobs:', err);
    res.status(500).send('Error retrieving images.');
  }
});

// Route: Login (Simulation)
app.get('/login', (req, res) => {
  res.render('login');
});

// Route: POST Login (Simulate login)
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'password') {
    req.session.user = { username, role: 'admin' };
    return res.redirect('/');
  } else if (username === 'user' && password === 'password') {
    req.session.user = { username, role: 'user' };
    return res.redirect('/');
  } else {
    return res.status(401).send('Invalid credentials');
  }
});

// Route: GET Upload form (only for logged-in users)
app.get('/upload', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('upload');
});

// Route: POST Image Upload (only for logged-in users)
app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }
  try {
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
