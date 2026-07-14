const fs = require('fs');
const bcrypt = require('bcryptjs');
const path = require('path');

const usersPath = path.join(__dirname, 'users.json');

async function migrate() {
  try {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    let count = 0;
    
    for (let u of users) {
      if (u.password && !u.password.startsWith('$2a$') && !u.password.startsWith('$2b$') && !u.password.startsWith('$2y$')) {
        u.password = await bcrypt.hash(u.password, 10);
        count++;
      }
    }
    
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    console.log(`Migratsiya tugadi: ${count} ta foydalanuvchi paroli hashlandi.`);
  } catch(e) {
    console.error('Xato:', e);
  }
}

migrate();
