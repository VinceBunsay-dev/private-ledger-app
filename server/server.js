
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const db = require('./db');
const { verifyToken, verifyAdmin } = require('./middleware/auth');

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : null;

app.use(
  cors({
    origin: allowedOrigins
      ? (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(new Error('Not allowed by CORS'));
        }
      : true,
  })
);
app.use(express.json({ limit: '50mb' }));

function generateReferralCode(name) {
  const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `${cleanName}${randomNum}`;
}

app.get('/', (req, res) => {
  res.json({ status: 'API is running' });
});

app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 + 1 AS result');
    res.json({ status: 'Connected to MySQL!', test: rows[0].result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, referral_code_input } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Email is already registered.' });
    }

    const [countRows] = await connection.query('SELECT COUNT(*) AS count FROM users');
    const role = countRows[0].count === 0 ? 'admin' : 'partner';

    let invitedByUserId = null;
    if (referral_code_input && referral_code_input.trim() !== '') {
      const [referrerRows] = await connection.query('SELECT id FROM users WHERE referral_code = ?', [referral_code_input.trim()]);
      if (referrerRows.length > 0) {
        invitedByUserId = referrerRows[0].id;
      } else {
        await connection.rollback();
        return res.status(400).json({ error: 'Invalid referral code provided.' });
      }
    }

    let newReferralCode = generateReferralCode(name);
    let codeExists = true;
    while (codeExists) {
      const [checkCode] = await connection.query('SELECT id FROM users WHERE referral_code = ?', [newReferralCode]);
      if (checkCode.length === 0) {
        codeExists = false;
      } else {
        newReferralCode = generateReferralCode(name);
      }
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    await connection.query(
      'INSERT INTO users (name, email, password, role, referral_code, invited_by, boosted_slots, has_made_first_purchase) VALUES (?, ?, ?, ?, ?, ?, 0, 0)',
      [name, email, hashedPassword, role, newReferralCode, invitedByUserId]
    );

    await connection.commit();
    res.status(201).json({
      message: `Account created successfully as ${role}!`,
      role
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        balance: user.balance,
        package_tier: user.package_tier,
        daily_revenue: user.daily_revenue,
        referral_code: user.referral_code,
        boosted_slots: user.boosted_slots
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/dashboard', verifyToken, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, role, balance, package_tier, daily_revenue, referral_code, boosted_slots FROM users WHERE id = ?',
      [req.user.id]
    );
    const [packages] = await db.query(
      'SELECT * FROM user_packages WHERE user_id = ? AND (remaining_days > 0 OR boosted_slots > 0 OR commission_slots_5pct > 0) ORDER BY created_at DESC',
      [req.user.id]
    );
    const [history] = await db.query(
      'SELECT * FROM ledger_history WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    const [deposits] = await db.query(
      'SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    const [withdrawals] = await db.query(
       'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC',
       [req.user.id]
    );

    res.json({ user: users[0], packages, history, deposits, withdrawals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/payment-methods', verifyToken, async (req, res) => {
  try {
    const [methods] = await db.query('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY created_at DESC');
    res.json(methods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/deposits', verifyToken, async (req, res) => {
  const { amount, reference_no, proof_image } = req.body;
  const parsedAmount = parseFloat(amount);

  if (!parsedAmount || parsedAmount <= 0 || !reference_no) {
    return res.status(400).json({ error: 'Valid amount and reference number are required.' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO deposits (user_id, amount, reference_no, proof_image, status) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, parsedAmount, reference_no.trim(), proof_image || null, 'pending']
    );

    res.status(201).json({
      message: 'Deposit submitted and pending admin verification.',
      depositId: result.insertId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/withdrawals', verifyToken, async (req, res) => {
  const { amount, payout_details } = req.body;
  const parsedAmount = parseFloat(amount);

  if (!parsedAmount || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Valid withdrawal amount is required.' });
  }
  if (!payout_details || payout_details.trim() === '') {
    return res.status(400).json({ error: 'Please provide your GCash or Bank account details.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    const currentBalance = parseFloat(users[0].balance);

    if (parsedAmount > currentBalance) {
      await connection.rollback();
      return res.status(400).json({ error: `Insufficient balance! You have ₱${currentBalance.toFixed(2)} available.` });
    }

    await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [parsedAmount, req.user.id]);

    const [result] = await connection.query(
      'INSERT INTO withdrawals (user_id, amount, payout_details, status) VALUES (?, ?, ?, ?)',
      [req.user.id, parsedAmount, payout_details.trim(), 'pending']
    );

    await connection.commit();
    res.status(201).json({
      message: 'Withdrawal request submitted successfully and pending admin review.',
      withdrawalId: result.insertId
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.get('/api/admin/overview', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const [pendingDeposits] = await db.query(`
      SELECT d.id, d.user_id, u.name, u.email, d.amount, d.reference_no, d.proof_image, d.status, d.created_at
      FROM deposits d
      JOIN users u ON d.user_id = u.id
      WHERE d.status = 'pending'
      ORDER BY d.created_at ASC
    `);

    const [approvedDeposits] = await db.query(`
      SELECT d.id, d.user_id, u.name, u.email, d.amount, d.reference_no, d.proof_image, d.status, d.created_at
      FROM deposits d
      JOIN users u ON d.user_id = u.id
      WHERE d.status = 'approved'
      ORDER BY d.created_at DESC
    `);

    const [partners] = await db.query(
      'SELECT id, name, email, role, balance, package_tier, daily_revenue, referral_code, boosted_slots, created_at FROM users ORDER BY balance DESC'
    );

    const [paymentMethods] = await db.query('SELECT * FROM payment_methods ORDER BY created_at DESC');

    const [adminRes] = await db.query(
      'SELECT balance FROM users WHERE id = ?',
      [req.user.id]
    );
    const totalSystemBalance = adminRes[0]?.balance || 0;

    res.json({ pendingDeposits, approvedDeposits, partners, paymentMethods, totalSystemBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/top-up-balance', verifyToken, verifyAdmin, async (req, res) => {
  const rawAmount = parseFloat(req.body.amount);
  const note = (req.body.note || '').trim();

  if (isNaN(rawAmount) || rawAmount <= 0) {
    return res.status(400).json({ error: 'Please enter a valid positive amount.' });
  }

  const amount = parseFloat(rawAmount.toFixed(2));

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [adminRows] = await connection.query(
      'SELECT id, balance FROM users WHERE id = ? AND role = "admin" FOR UPDATE',
      [req.user.id]
    );

    if (adminRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Admin account not found.' });
    }

    await connection.query(
      'UPDATE users SET balance = balance + ? WHERE id = ?',
      [amount, adminRows[0].id]
    );

    const description = note
      ? `Admin balance top-up: ₱${amount.toFixed(2)} (${note})`
      : `Admin balance top-up: ₱${amount.toFixed(2)}`;

    await connection.query(
      'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
      [adminRows[0].id, 'admin_top_up', amount, description]
    );

    const [updatedRows] = await connection.query(
      'SELECT balance FROM users WHERE id = ?',
      [adminRows[0].id]
    );

    await connection.commit();

    res.json({
      message: `Added ₱${amount.toFixed(2)} to admin balance.`,
      newBalance: parseFloat(parseFloat(updatedRows[0].balance || 0).toFixed(2))
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.post('/api/admin/deposits/:id/decision', verifyToken, verifyAdmin, async (req, res) => {
  const depositId = req.params.id;
  const { action } = req.body;

  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ error: "Action must be 'approved' or 'rejected'." });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [deposits] = await connection.query(
      'SELECT * FROM deposits WHERE id = ? FOR UPDATE',
      [depositId]
    );

    if (deposits.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Deposit not found.' });
    }

    const deposit = deposits[0];
    if (deposit.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ error: `Deposit is already ${deposit.status}.` });
    }

    await connection.query('UPDATE deposits SET status = ? WHERE id = ?', [action, depositId]);

    if (action === 'approved') {
      await connection.query(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [deposit.amount, deposit.user_id]
      );

      await connection.query(
        'UPDATE users SET balance = balance + ? WHERE role = "admin"',
        [deposit.amount]
      );

      await connection.query(
        'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
        [deposit.user_id, 'deposit', deposit.amount, `Approved deposit (Ref: ${deposit.reference_no})`]
      );
    }

    await connection.commit();
    res.json({ message: `Deposit ${action} successfully.` });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.get('/api/admin/withdrawals/pending', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const [pendingWithdrawals] = await db.query(`
      SELECT w.id, w.user_id, u.name, u.email, w.amount, w.payout_details, w.status, w.created_at
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE w.status = 'pending'
      ORDER BY w.created_at ASC
    `);

    res.json({ pendingWithdrawals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/withdrawals/:id/decision', verifyToken, verifyAdmin, async (req, res) => {
  const withdrawalId = req.params.id;
  const { action, proof_image } = req.body;

  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ error: "Action must be 'approved' or 'rejected'." });
  }

  if (action === 'approved' && !proof_image) {
    return res.status(400).json({ error: 'Please attach a screenshot proof of payout before approving.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [withdrawals] = await connection.query(
      'SELECT * FROM withdrawals WHERE id = ? FOR UPDATE',
      [withdrawalId]
    );

    if (withdrawals.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Withdrawal request not found.' });
    }

    const withdrawal = withdrawals[0];
    if (withdrawal.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ error: `Withdrawal request is already ${withdrawal.status}.` });
    }

    if (action === 'approved') {
      await connection.query(
        'UPDATE withdrawals SET status = ?, proof_image = ? WHERE id = ?',
        ['approved', proof_image, withdrawalId]
      );

      await connection.query(
        'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
        [withdrawal.user_id, 'withdrawal', withdrawal.amount, `Withdrawal approved & paid out (₱${withdrawal.amount})`]
      );
    } else {
      await connection.query('UPDATE withdrawals SET status = ? WHERE id = ?', ['rejected', withdrawalId]);
      await connection.query(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [withdrawal.amount, withdrawal.user_id]
      );

      await connection.query(
        'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
        [withdrawal.user_id, 'withdrawal_rejected', withdrawal.amount, `Withdrawal request was rejected (₱${withdrawal.amount} refunded)`]
      );
    }

    await connection.commit();
    res.json({ message: `Withdrawal request ${action} successfully.` });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.post('/api/admin/payment-methods', verifyToken, verifyAdmin, async (req, res) => {
  const { channel_name, qr_image_url, instructions } = req.body;
  if (!channel_name || !qr_image_url) {
    return res.status(400).json({ error: 'Channel name and QR image are required.' });
  }

  try {
    await db.query(
      'INSERT INTO payment_methods (channel_name, qr_image_url, instructions) VALUES (?, ?, ?)',
      [channel_name.trim(), qr_image_url.trim(), instructions ? instructions.trim() : '']
    );
    res.status(201).json({ message: 'QR Payment channel added successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/payment-methods/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM payment_methods WHERE id = ?', [req.params.id]);
    res.json({ message: 'Payment channel removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/packages/select', verifyToken, async (req, res) => {
  const { tier } = req.body;
  const tierAmount = parseInt(tier);

  if (![500, 1000].includes(tierAmount)) {
    return res.status(400).json({ error: 'Invalid package tier selected. Choose 500 or 1000.' });
  }

  const dailyRevIncrement = tierAmount === 1000 ? 70.00 : 30.00;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      'SELECT balance, daily_revenue, invited_by, has_made_first_purchase FROM users WHERE id = ? FOR UPDATE',
      [req.user.id]
    );

    const user = users[0];
    const currentBalance = parseFloat(user.balance);

    if (currentBalance < tierAmount) {
      await connection.rollback();
      return res.status(400).json({ 
        error: `Insufficient balance! You need ₱${tierAmount} to buy this package, but your current balance is ₱${currentBalance.toFixed(2)}.` 
      });
    }

    await connection.query(
      'UPDATE users SET balance = balance - ?, package_tier = ?, daily_revenue = daily_revenue + ?, boosted_slots = boosted_slots + 3 WHERE id = ?',
      [tierAmount, tierAmount, dailyRevIncrement, req.user.id]
    );

    await connection.query(
      'INSERT INTO user_packages (user_id, tier, daily_revenue, remaining_days, boosted_slots, commission_slots_5pct) VALUES (?, ?, ?, 10, 3, 10)',
      [req.user.id, tierAmount, dailyRevIncrement]
    );

    await connection.query(
      'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
      [req.user.id, 'package_join', tierAmount, `Purchased ₱${tierAmount} Package (₱${dailyRevIncrement}/day for 10 days, +3 Boosted Slots, +10 5% Slots)`]
    );

    if (user.invited_by && user.has_made_first_purchase === 0) {
      await connection.query('UPDATE users SET has_made_first_purchase = 1 WHERE id = ?', [req.user.id]);

      const [referrerRows] = await connection.query(
        'SELECT id, boosted_slots FROM users WHERE id = ? FOR UPDATE',
        [user.invited_by]
      );

      if (referrerRows.length > 0) {
        const referrer = referrerRows[0];
        const [refPackages] = await connection.query(
          'SELECT id FROM user_packages WHERE user_id = ? LIMIT 1',
          [referrer.id]
        );

        if (refPackages.length > 0) {
          let commissionRate = 0;
          let rateLabel = '';

          if (referrer.boosted_slots > 0) {
            commissionRate = 0.10;
            rateLabel = '10%';
            await connection.query('UPDATE users SET boosted_slots = boosted_slots - 1 WHERE id = ?', [referrer.id]);
            await connection.query(
              'UPDATE user_packages SET boosted_slots = boosted_slots - 1 WHERE user_id = ? AND boosted_slots > 0 ORDER BY created_at ASC LIMIT 1',
              [referrer.id]
            );
          } else {
            const [pkg5pct] = await connection.query(
              'SELECT id FROM user_packages WHERE user_id = ? AND commission_slots_5pct > 0 ORDER BY created_at ASC LIMIT 1',
              [referrer.id]
            );

            if (pkg5pct.length > 0) {
              commissionRate = 0.05;
              rateLabel = '5%';
              await connection.query('UPDATE user_packages SET commission_slots_5pct = commission_slots_5pct - 1 WHERE user_id = ? AND id = ?', [referrer.id, pkg5pct[0].id]);
            }
          }

          if (commissionRate > 0) {
            const roundedCommission = parseFloat((tierAmount * commissionRate).toFixed(2));
            await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [roundedCommission, referrer.id]);
            await connection.query(
              'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
              [referrer.id, 'referral_commission', roundedCommission, `Earned ${rateLabel} referral commission (₱${roundedCommission.toFixed(2)}) from invite's first package purchase`]
            );

            const [adminRows] = await connection.query('SELECT id FROM users WHERE role = "admin" LIMIT 1 FOR UPDATE');
            if (adminRows.length > 0) {
              await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [roundedCommission, adminRows[0].id]);
              await connection.query(
                'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
                [adminRows[0].id, 'referral_commission_outflow', roundedCommission, `Referral commission payout (${rateLabel}) for invite purchase: ₱${roundedCommission.toFixed(2)}`]
              );
            }
          }
        }
      }
    }

    await connection.commit();
    res.json({
      message: `Successfully purchased the ₱${tierAmount} Package! (₱${dailyRevIncrement}/day for 10 days + 3 Boosted Slots + 10 5% Slots).`,
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.post('/api/admin/distribute-tier-revenue', verifyToken, verifyAdmin, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    let totalYieldDistributed = 0;

    const [activePackages] = await connection.query(
      'SELECT id, user_id, tier, daily_revenue, remaining_days FROM user_packages WHERE remaining_days > 0 FOR UPDATE'
    );

    const userEarnings = {};
    for (const pkg of activePackages) {
      const rev = parseFloat(pkg.daily_revenue);
      if (!userEarnings[pkg.user_id]) {
        userEarnings[pkg.user_id] = { totalRev: 0, packageIds: [] };
      }
      userEarnings[pkg.user_id].totalRev += rev;
      userEarnings[pkg.user_id].packageIds.push(pkg.id);
    }

    for (const userId in userEarnings) {
      const earnings = userEarnings[userId];
      const roundedRev = parseFloat(earnings.totalRev.toFixed(2));
      totalYieldDistributed += roundedRev;
    }

    if (totalYieldDistributed > 0) {
      const finalYield = parseFloat(totalYieldDistributed.toFixed(2));
      const [adminCheck] = await connection.query('SELECT id, balance FROM users WHERE role = "admin" LIMIT 1 FOR UPDATE');
      if (adminCheck.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Admin account not found.' });
      }

      const adminUser = adminCheck[0];
      const currentAdminBalance = parseFloat(parseFloat(adminUser.balance || 0).toFixed(2));

      if (currentAdminBalance < finalYield) {
        await connection.rollback();
        const shortfall = parseFloat((finalYield - currentAdminBalance).toFixed(2));
        return res.status(400).json({
          error: `Insufficient admin balance to process payout. Required: ₱${finalYield.toFixed(2)}, Available: ₱${currentAdminBalance.toFixed(2)} (Shortfall: ₱${shortfall.toFixed(2)}). Please top up admin balance first.`
        });
      }

      for (const userId in userEarnings) {
        const earnings = userEarnings[userId];
        const roundedRev = parseFloat(earnings.totalRev.toFixed(2));

        await connection.query('UPDATE users SET balance = balance + ? WHERE id = ?', [roundedRev, userId]);
        await connection.query(
          'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
          [userId, 'yield', roundedRev, `Daily accumulated revenue payout (₱${roundedRev.toFixed(2)})`]
        );

        for (const pkgId of earnings.packageIds) {
          await connection.query('UPDATE user_packages SET remaining_days = remaining_days - 1 WHERE id = ?', [pkgId]);
        }
      }

      const [allUsers] = await connection.query('SELECT id FROM users');
      for (const u of allUsers) {
        const [sumRes] = await connection.query(
          'SELECT COALESCE(SUM(daily_revenue), 0) AS active_rev FROM user_packages WHERE user_id = ? AND remaining_days > 0',
          [u.id]
        );
        const roundedActiveRev = parseFloat(parseFloat(sumRes[0].active_rev || 0).toFixed(2));
        await connection.query('UPDATE users SET daily_revenue = ? WHERE id = ?', [roundedActiveRev, u.id]);
      }

      await connection.query('UPDATE users SET balance = balance - ? WHERE id = ?', [finalYield, adminUser.id]);
      await connection.query(
        'INSERT INTO ledger_history (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
        [adminUser.id, 'admin_batch_outflow', finalYield, `Daily yield payout distributed: ₱${finalYield.toFixed(2)}`]
      );
    }

    await connection.commit();
    res.json({
      message: `Daily payout executed! Yield distributed: ₱${totalYieldDistributed.toFixed(2)}. Expired packages updated.`,
      totalYieldDistributed: totalYieldDistributed.toFixed(2)
    });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.delete('/api/admin/deposits/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM deposits WHERE id = ? AND status = "approved"', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Deposit record not found.' });
    }
    res.json({ message: 'Deposit history record deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/impersonate/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'Partner not found.' });
    }

    const targetUser = users[0];
    const token = jwt.sign(
      { id: targetUser.id, role: targetUser.role },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    res.json({
      token,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
        balance: targetUser.balance,
        package_tier: targetUser.package_tier,
        daily_revenue: targetUser.daily_revenue,
        referral_code: targetUser.referral_code,
        boosted_slots: targetUser.boosted_slots
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
