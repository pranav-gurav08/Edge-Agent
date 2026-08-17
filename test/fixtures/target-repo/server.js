const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();

const SECRET = process.env.JWT_SECRET || 'hardcoded-secret-do-not-ship';

function authenticate(req, res, next) {
  const token = req.headers.authorization;
  jwt.verify(token, SECRET);
  next();
}

app.get('/admin', authenticate, (req, res) => {
  res.json({ admin: true });
});

app.listen(3000);
