require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Session config
app.use(session({
  secret: process.env.SESSION_SECRET || 'secretkey',
  resave: false,
  saveUninitialized: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// In-memory user storage
const users = [
  { username: 'admin', password: 'password', role: 'admin' },
  { username: 'user', password: 'password', role: 'user' }
];

// Azure blob config
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(process.env.AZURE_STORAGE_CONTAINER_NAME);
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

function ensureAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

function ensureAdmin(req, res, next) {
  if (req.session.user?.role === 'admin') return next();
  res.status(403).send('Forbidden');
}

// Routes

app.get('/', (req, res) => {
  if (!req.session.user) return res.render('index');
  res.redirect('/gallery');
});

app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.render('register', { error: 'All fields required' });
  }
  if (users.find(u => u.username === username)) {
    return res.render('register', { error: 'Username already exists' });
  }
  users.push({ username, password, role });
  res.redirect('/login?registered=1');
});

app.get('/login', (req, res) => {
  res.render('login', {
    error: req.query.error,
    registerSuccess: req.query.registered
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.redirect('/login?error=1');
  req.session.user = { username: user.username, role: user.role };
  res.redirect('/gallery');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

app.get('/gallery', ensureAuth, async (req, res) => {
  try {
    const blobs = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      blobs.push({
        name: blob.name,
        url: containerClient.getBlockBlobClient(blob.name).url
      });
    }
    res.render('gallery', { images: blobs });
  } catch (err) {
    console.error('Gallery Error:', err.message);
    res.status(500).send('Error loading gallery');
  }
});

app.get('/upload', ensureAuth, (req, res) => {
  res.render('upload');
});

app.post('/upload', ensureAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');
    const blobName = `${Date.now()}-${req.file.originalname}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(req.file.buffer);
    res.redirect('/gallery');
  } catch (err) {
    console.error('Upload Error:', err.message);
    res.status(500).send('Upload failed');
  }
});

app.post('/delete', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const blobName = req.body.name;
    if (!blobName) return res.status(400).send('Missing image name');
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.delete();
    res.redirect('/gallery');
  } catch (err) {
    console.error('Delete Error:', err.message);
    res.status(500).send('Failed to delete');
  }
});

app.listen(port, () => console.log(`App running on port ${port}`));
