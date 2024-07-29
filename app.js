const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bodyParser = require('body-parser');
const mysql = require('mysql');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { body, validationResult } = require('express-validator');

const app = express();

// Database connection pool setup
const dbPool = mysql.createPool({
  connectionLimit: 10,
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'event_management'
});

// Session store setup
const sessionStore = new MySQLStore({
  expiration: 86400000, // Session expiration time (in ms)
  createDatabaseTable: true
}, dbPool);

// Connect to MySQL database
dbPool.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to database:', err);
    process.exit(1);
  }
  console.log('MySQL connected');
  connection.release();
});

// Middleware setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: false,
  store: sessionStore
}));



// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function(req, file, cb) {
    cb(null, (file.originalname));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 5 } // Example limit: 5MB, Use to set file limit
});

// Example usage in your route handling profile edit
app.post('/profile/edit', upload.single('profile_picture'), (req, res) => {
  const { username, email } = req.body;
  const userId = req.session.userId;
  const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

  let sql;
  let queryParams;
  if (profilePicture) {
    sql = 'UPDATE users SET username = ?, email = ?, profile_picture = ? WHERE user_id = ?';
    queryParams = [username, email, profilePicture, userId];
  } else {
    sql = 'UPDATE users SET username = ?, email = ? WHERE user_id = ?';
    queryParams = [username, email, userId];
  }

  dbPool.query(sql, queryParams, (err, result) => {
    if (err) {
      console.error('Error updating user:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.redirect('/profile'); // Redirect to profile page after successful update
  });
});

// Middleware to set userId if logged in
app.use((req, res, next) => {
  res.locals.userId = req.session.userId || null;
  next();
});

// Routes
app.get('/', (req, res) => {
  let sql = 'SELECT * FROM events';
  dbPool.query(sql, (err, events) => {
    if (err) {
      console.error('Error fetching events:', err);
      return res.status(500).send('Internal Server Error');
    }
    if (req.session.userId) {
      let userSql = 'SELECT * FROM users WHERE user_id = ?';
      dbPool.query(userSql, [req.session.userId], (userErr, users) => {
        if (userErr) {
          console.error('Error fetching user:', userErr);
          return res.status(500).send('Internal Server Error');
        }
        const user = users[0];
        res.render('index', { events, userId: req.session.userId, user });
      });
    } else {
      res.render('index', { events, userId: req.session.userId, user: null });
    }
  });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  let sql = 'SELECT * FROM users WHERE email = ?';
  dbPool.query(sql, [email], async (err, results) => {
    if (err) {
      console.error('Error fetching user:', err);
      return res.status(500).send('Internal Server Error');
    }
    if (results.length === 0) {
      return res.status(400).send('No user found with this email');
    }
    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).send('Incorrect password');
    }
    req.session.userId = user.user_id;
    res.redirect('/');
  });
});

app.get('/register', (req, res) => {
  res.render('register');
});

// Validate registration inputs
app.post('/register', upload.single('profile_picture'), [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('email').trim().isEmail().withMessage('Invalid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('register', { errors: errors.array() });
  }

  const { username, email, password, role } = req.body;
  const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    let sql = 'INSERT INTO users (username, email, password, role, profile_picture) VALUES (?, ?, ?, ?, ?)';
    dbPool.query(sql, [username, email, hashedPassword, role, profilePicture], (err, result) => {
      if (err) {
        console.error('Error registering user:', err);
        return res.status(500).send('Internal Server Error');
      }
      req.session.userId = result.insertId;
      res.redirect('/');
    });
  } catch (err) {
    console.error('Error hashing password:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/events', (req, res) => {
  let sql = 'SELECT * FROM events';
  dbPool.query(sql, (err, events) => {
    if (err) {
      console.error('Error fetching events:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.render('events', { events, userId: req.session.userId });
  });
});

app.get('/events/add', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  res.render('add_event', { userId: req.session.userId });
});

app.post('/events/add', (req, res) => {
  const { title, description, date, time, location, category } = req.body;
  const userId = req.session.userId;

  const sql = 'INSERT INTO events (title, description, date, time, location, category, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)';
  dbPool.query(sql, [title, description, date, time, location, category, userId], (err, result) => {
    if (err) {
      console.error('Error adding event:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.redirect('/events');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.redirect('/');
  });
});

app.get('/events/delete/:id', (req, res) => {
  const eventId = req.params.id;

  if (!req.session.userId) {
    return res.redirect('/login');
  }

  let sql = 'DELETE FROM events WHERE event_id = ? AND created_by = ?';
  dbPool.query(sql, [eventId, req.session.userId], (err, result) => {
    if (err) {
      console.error('Error deleting event:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.redirect('/events');
  });
});

app.get('/events/edit/:event_id', (req, res) => {
  const eventId = req.params.event_id;

  let sql = 'SELECT * FROM events WHERE event_id = ?';
  dbPool.query(sql, [eventId], (err, results) => {
    if (err) {
      console.error('Error fetching event:', err);
      return res.status(500).send('Internal Server Error');
    }
    if (results.length === 0) {
      return res.status(404).send('Event not found');
    }
    const event = results[0];
    res.render('edit_event', { event });
  });
});

app.post('/events/edit/:event_id', (req, res) => {
  const eventId = req.params.event_id;
  const { title, description, date, time, location, category } = req.body;

  const sql = 'UPDATE events SET title = ?, description = ?, date = ?, time = ?, location = ?, category = ? WHERE event_id = ?';
  dbPool.query(sql, [title, description, date, time, location, category, eventId], (err, results) => {
    if (err) {
      console.error('Error updating event:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.redirect('/events');
  });
});


// Add route to render user profile page
app.get('/profile', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login'); // Redirect if not logged in
  }

  let sql = 'SELECT * FROM users WHERE user_id = ?';
  dbPool.query(sql, [req.session.userId], (err, users) => {
    if (err || users.length === 0) {
      console.error('Error fetching user:', err);
      return res.status(500).send('Internal Server Error');
    }
    const user = users[0];
    res.render('profile', { user });
  });
});

// Add route to render user profile edit page

app.get('/profile/edit', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  let sql = 'SELECT * FROM users WHERE user_id = ?';
  dbPool.query(sql, [req.session.userId], (err, users) => {
    if (err || users.length === 0) {
      console.error('Error fetching user:', err);
      return res.status(500).send('Internal Server Error');
    }
    const user = users[0];
    res.render('edit_profile', { user });
  });
});



  // Add route to handle updating user information
app.post('/profile', upload.single('profile_picture'), (req, res) => {
  const { username, email } = req.body;
  const userId = req.session.userId;
  const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

  let sql;
  let queryParams;
  if (profilePicture) {
    sql = 'UPDATE users SET username = ?, email = ?, profile_picture = ? WHERE user_id = ?';
    queryParams = [username, email, profilePicture, userId];
  } else {
    sql = 'UPDATE users SET username = ?, email = ? WHERE user_id = ?';
    queryParams = [username, email, userId];
  }

  dbPool.query(sql, queryParams, (err, result) => {
    if (err) {
      console.error('Error updating user:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.redirect('/profile');
  });
});



// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
