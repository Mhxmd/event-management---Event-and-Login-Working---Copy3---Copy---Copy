// Handle profile picture in registration
app.post('/register', async (req, res) => {
    const { username, email, password, role, profile_picture } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const sql = 'INSERT INTO users (username, email, password, role, profile_picture) VALUES (?, ?, ?, ?, ?)';
      db.query(sql, [username, email, hashedPassword, role, profile_picture], (err, result) => {
        if (err) {
          console.error('Error registering user:', err);
          return res.status(500).send('Server error');
        }
        res.redirect('/login');
      });
    } catch (err) {
      console.error('Error hashing password:', err);
      res.status(500).send('Server error');
    }
  });
  