require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');

const app = express();

// Express session setup (in-memory store)
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',  // secret for signing session ID cookie
  resave: false,
  saveUninitialized: false
}));

// Body parsers for form data
app.use(express.urlencoded({ extended: true }));   // parse URL-encoded form bodies

// Serve static files (CSS, etc.)
app.use(express.static('public'));

// Set EJS as the templating engine
app.set('view engine', 'ejs');

// In-memory user "database"
const users = [];  // Will hold objects: { username, password, role }

// Azure Blob Storage client setup
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(process.env.AZURE_STORAGE_CONTAINER_NAME);
// (Ensure that the container exists in your Azure Storage account before running the app)

// Configure Multer for file uploads (store files in memory as Buffer)
const upload = multer({ storage: multer.memoryStorage() });
/* Multer's memoryStorage provides the file in req.file.buffer for direct use&#8203;:contentReference[oaicite:4]{index=4} */

// Middleware to make `req.session.user` available in templates as `user`
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// Authentication middleware to protect routes
function ensureAuth(req, res, next) {
  if (req.session.user) {
    return next();
  }
  // If not logged in, redirect to landing page
  res.redirect('/');
}

// Authorization middleware for admin-only actions
function ensureAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  // If not an admin, respond with Forbidden
  return res.status(403).send('Forbidden');
}

// ** Routes ** //

// Landing page (home)
app.get('/', (req, res) => {
  if (!req.session.user) {
    // Not logged in: show prompt to log in or register
    return res.render('index');
  } else {
    // Logged in: redirect to gallery
    return res.redirect('/gallery');
  }
});

// Registration page
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// Handle registration form submission
app.post('/register', (req, res) => {
  const { username, password, role } = req.body;
  // Basic validation
  if (!username || !password || !role) {
    return res.render('register', { error: 'All fields are required.' });
  }
  // Check if username is already taken
  if (users.find(u => u.username === username)) {
    return res.render('register', { error: 'Username already taken.' });
  }
  // Store new user (password stored in plain text for this demo)
  users.push({ username, password, role });
  // Redirect to login page with a success indicator
  return res.redirect('/login?registerSuccess=1');
});

// Login page
app.get('/login', (req, res) => {
  // If redirected after registration, `registerSuccess` will be set
  const registerSuccess = req.query.registerSuccess;
  const error = req.query.error;
  res.render('login', { registerSuccess, error });
});

// Handle login form submission
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    // Credentials match: save user info in session
    req.session.user = { username: user.username, role: user.role };
    // Redirect to gallery after successful login
    return res.redirect('/gallery');
  } else {
    // Login failed: redirect back to login with error flag
    return res.redirect('/login?error=1');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  // Destroy the session and clear cookie
  req.session.destroy(err => {
    res.clearCookie('connect.sid');
    return res.redirect('/');
  });
});

// Gallery page (protected: must be logged in)
app.get('/gallery', ensureAuth, async (req, res) => {
  try {
    // Retrieve list of blobs (images) from Azure Blob Storage
    const blobs = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      // Construct a public URL for each blob
      const blobClient = containerClient.getBlockBlobClient(blob.name);
      blobs.push({ 
        name: blob.name, 
        url: blobClient.url  // URL to directly access the image&#8203;:contentReference[oaicite:5]{index=5}
      });
    }
    return res.render('gallery', { images: blobs });
  } catch (err) {
    console.error('Error listing blobs:', err);
    return res.status(500).send('Error retrieving images.');
  }
});

// Upload page (protected)
app.get('/upload', ensureAuth, (req, res) => {
  res.render('upload');
});

// Handle image upload form submission (protected)
app.post('/upload', ensureAuth, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }
  try {
    // Use current timestamp to help make unique blob names
    const originalName = req.file.originalname;
    const blobName = Date.now() + '-' + originalName;
    // Upload the file buffer to Azure Blob Storage
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(req.file.buffer);
    // After successful upload, redirect to gallery to show the new image
    return res.redirect('/gallery');
  } catch (err) {
    console.error('Error uploading file:', err);
    return res.status(500).send('Upload failed. Please try again.');
  }
});

// Delete image (admin only)
app.post('/delete', ensureAuth, ensureAdmin, async (req, res) => {
  const blobName = req.body.name;
  if (!blobName) {
    return res.status(400).send('No image specified.');
  }
  try {
    // Delete the blob from Azure Storage
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.delete();
    return res.redirect('/gallery');
  } catch (err) {
    console.error('Error deleting blob:', err);
    return res.status(500).send('Failed to delete image.');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
