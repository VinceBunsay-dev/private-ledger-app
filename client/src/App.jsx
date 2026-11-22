import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_URL =
  import.meta.env?.VITE_API_URL || 'http://localhost:5000/api';
  
  'http://localhost:5000/api';

const compressImageAndConvert = (file, callback) => {
  if (!file.type.match(/image.*/)) {
    alert('Please upload a valid image file (JPEG, PNG, or WebP).');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 800;
      const scaleSize = MAX_WIDTH / img.width;
      canvas.width = MAX_WIDTH;
      canvas.height = img.height * scaleSize;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
      callback(compressedDataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [dashboard, setDashboard] = useState({ user: null, packages: [], history: [], deposits: [], withdrawals: [] });
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [adminData, setAdminData] = useState({ 
    pendingDeposits: [],    
    approvedDeposits: [], 
    pendingWithdrawals: [], 
    partners: [], 
    paymentMethods: [],
    totalSystemBalance: 0 
  });
  
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [error, setError] = useState('');

  const [depositAmount, setDepositAmount] = useState('');
  const [refNo, setRefNo] = useState('');
  const [depositProof, setDepositProof] = useState('');

  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [payoutDetails, setPayoutDetails] = useState('');

  const [channelName, setChannelName] = useState('');
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [qrInstructions, setQrInstructions] = useState('');

  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpNote, setTopUpNote] = useState('');

  const [withdrawalProofs, setWithdrawalProofs] = useState({});
  const [viewingProofImage, setViewingProofImage] = useState(null);

  const [packageError, setPackageError] = useState('');

  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      fetchDashboard();
      fetchPaymentMethods();
    } else {
      localStorage.removeItem('token');
      setUser(null);
    }
  }, [token]);

  const fetchDashboard = async () => {
    try {
      const res = await axios.get(`${API_URL}/user/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(res.data.user);
      setDashboard(res.data);
      if (res.data.user.role === 'admin') {
        fetchAdminData();
      }
    } catch (err) {
      console.error(err);
      handleLogout();
    }
  };

  const fetchPaymentMethods = async () => {
    try {
      const res = await axios.get(`${API_URL}/payment-methods`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPaymentMethods(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAdminData = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/overview`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const withdrawalRes = await axios.get(`${API_URL}/admin/withdrawals/pending`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAdminData({
        ...res.data,
        pendingWithdrawals: withdrawalRes.data.pendingWithdrawals
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    const endpoint = isRegister ? '/auth/register' : '/auth/login';
    try {
      const payload = isRegister 
        ? { name, email, password, referral_code_input: referralCodeInput }
        : { email, password };

      const res = await axios.post(`${API_URL}${endpoint}`, payload);
      if (isRegister) {
        alert('Account created successfully! Please log in.');
        setIsRegister(false);
      } else {
        setToken(res.data.token);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
  };

  const selectPackage = async (tier) => {
    setPackageError('');
    if (!window.confirm(`Are you sure you want to purchase the ₱${tier} Package? This will deduct ₱${tier} from your balance, start your earnings, and add +3 Boosted Slots.`)) return;
    try {
      const res = await axios.post(`${API_URL}/packages/select`, { tier }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert(res.data.message);
      fetchDashboard();
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Failed to purchase package.';
      setPackageError(errorMessage);
    }
  };

  const handleDepositProofUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImageAndConvert(file, (compressedBase64) => {
      setDepositProof(compressedBase64);
    });
  };

  const submitDeposit = async (e) => {
    e.preventDefault();
    if (!depositProof) {
      alert('Please attach a screenshot proof of payment for your deposit.');
      return;
    }
    try {
      await axios.post(`${API_URL}/deposits`, { 
        amount: depositAmount, 
        reference_no: refNo,
        proof_image: depositProof 
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Deposit submitted for admin approval!');
      setDepositAmount('');
      setRefNo('');
      setDepositProof('');
      fetchDashboard();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit deposit.');
    }
  };

  const submitWithdrawal = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Are you sure you want to request a withdrawal of ₱${withdrawalAmount}?`)) return;
    try {
      await axios.post(`${API_URL}/withdrawals`, { amount: withdrawalAmount, payout_details: payoutDetails }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Withdrawal request submitted successfully! Pending admin review.');
      setWithdrawalAmount('');
      setPayoutDetails('');
      fetchDashboard();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to request withdrawal.');
    }
  };

  const handleDepositDecision = async (id, action) => {
    if (!window.confirm(`Are you sure you want to ${action} this deposit request?`)) return;
    try {
      await axios.post(`${API_URL}/admin/deposits/${id}/decision`, { action }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert(`Deposit ${action}!`);
      fetchDashboard();
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed.');
    }
  };

  const handleWithdrawalProofUpload = (withdrawalId, e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImageAndConvert(file, (compressedBase64) => {
      setWithdrawalProofs(prev => ({ ...prev, [withdrawalId]: compressedBase64 }));
    });
  };

  const handleWithdrawalDecision = async (id, action) => {
    const proofImage = withdrawalProofs[id] || null;
    if (action === 'approved' && !proofImage) {
      alert('Please attach a screenshot proof of payout before approving.');
      return;
    }

    if (!window.confirm(`Are you sure you want to ${action} this withdrawal request?`)) return;

    try {
      await axios.post(`${API_URL}/admin/withdrawals/${id}/decision`, { 
        action,
        proof_image: proofImage 
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert(`Withdrawal request ${action}!`);
      setWithdrawalProofs(prev => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
      fetchDashboard();
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed.');
    }
  };

  const deleteDepositHistory = async (id) => {
    if (!window.confirm('Are you sure you want to delete this deposit record from the history log?')) return;
    try {
      await axios.delete(`${API_URL}/admin/deposits/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Deposit record deleted successfully!');
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete record.');
    }
  };

  const handleQrFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImageAndConvert(file, (compressedBase64) => {
      setQrImageUrl(compressedBase64);
    });
  };

  const handleAddPaymentMethod = async (e) => {
    e.preventDefault();
    if (!channelName || !qrImageUrl) {
      alert('Please provide a channel name and upload a QR image.');
      return;
    }
    try {
      await axios.post(`${API_URL}/admin/payment-methods`, {
        channel_name: channelName,
        qr_image_url: qrImageUrl,
        instructions: qrInstructions
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('QR Payment channel added successfully!');
      setChannelName('');
      setQrImageUrl('');
      setQrInstructions('');
      fetchPaymentMethods();
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add payment channel.');
    }
  };

  const handleDeletePaymentMethod = async (id) => {
    if (!window.confirm('Remove this QR payment channel?')) return;
    try {
      await axios.delete(`${API_URL}/admin/payment-methods/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchPaymentMethods();
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete channel.');
    }
  };

  const handleAdminTopUp = async (e) => {
    e.preventDefault();
    const parsed = parseFloat(topUpAmount);
    if (isNaN(parsed) || parsed <= 0) {
      alert('Please enter a valid positive top-up amount.');
      return;
    }
    if (!window.confirm(`Add ₱${parsed.toFixed(2)} to your admin balance?`)) return;
    try {
      const res = await axios.post(`${API_URL}/admin/top-up-balance`, {
        amount: parsed,
        note: topUpNote
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert(res.data.message);
      setTopUpAmount('');
      setTopUpNote('');
      fetchDashboard();
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to top up admin balance.');
    }
  };

  const distributeTierRevenue = async () => {
    if (!window.confirm('Distribute daily revenue yields?')) return;
    try {
      const res = await axios.post(`${API_URL}/admin/distribute-tier-revenue`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert(res.data.message);
      fetchDashboard();
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.error || 'Revenue distribution failed.');
    }
  };

  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h2>Private Ledger</h2>
          <p className="subtitle">{isRegister ? 'Create Partner Account' : 'Sign in to your account'}</p>
          {error && <div className="error-box">{error}</div>}
          <form onSubmit={handleAuth}>
            {isRegister && (
              <>
                <input type="text" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} required />
                <input type="text" placeholder="Referral Code (Optional)" value={referralCodeInput} onChange={e => setReferralCodeInput(e.target.value)} />
              </>
            )}
            <input type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
            <button type="submit" className="btn-primary">{isRegister ? 'Register' : 'Login'}</button>
          </form>
          <p className="switch-mode" onClick={() => setIsRegister(!isRegister)}>
            {isRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* Return to Admin Banner */}
      {localStorage.getItem('admin_token') && (
        <div style={{ backgroundColor: '#f59e0b', color: '#000', padding: '10px 20px', textAlign: 'center', fontWeight: 'bold', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginBottom: '15px', borderRadius: '6px' }}>
          <span>👁️ Viewing Partner Account (Read-Only): {user?.name} ({user?.email})</span>
          <button
            style={{ backgroundColor: '#000', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => {
              localStorage.setItem('token', localStorage.getItem('admin_token'));
              localStorage.removeItem('admin_token');
              window.location.reload();
            }}
          >
            ⬅️ Return to Admin Dashboard
          </button>
        </div>
      )}

      <header className="top-bar">
        <h1>Private Ledger</h1>
        <div className="user-info">
          <span>{user?.name} ({user?.role?.toUpperCase()})</span>
          <button onClick={handleLogout} className="btn-logout">Logout</button>
        </div>
      </header>

      <div className="balance-card">
        <h3>{user?.role === 'admin' ? 'Total System Partner Balances' : 'Current Balance'}</h3>
        <h2>
          ₱ {parseFloat(
            user?.role === 'admin' 
              ? (adminData.totalSystemBalance || 0) 
              : (user?.balance || 0)
          ).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </h2>
        <p className="package-info">
          {user?.role === 'admin' 
            ? `Managed across ${adminData.partners?.length || 0} registered partner(s)`
            : `Total Earning Rate: ₱${user?.daily_revenue || 0} / day | Available 10% Boosted Slots: ${user?.boosted_slots || 0}`
          }
        </p>
      </div>

      {/* REFERRAL SHARING CARD FOR PARTNERS */}
      {user?.role !== 'admin' && (
        <div className="card full-width" style={{ marginBottom: '20px', background: 'rgba(14, 165, 233, 0.05)', border: '1px solid #0ea5e9' }}>
          <h3>🔗 Your Referral Program</h3>
          <p className="muted" style={{ margin: '0 0 10px 0' }}>
            Share your unique referral code with new partners. When they make their <strong>first ever package purchase</strong>, you earn commission!
          </p>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <span>Your Referral Code: </span>
              <strong style={{ fontSize: '18px', color: '#38bdf8', background: '#0f172a', padding: '6px 12px', borderRadius: '6px', border: '1px solid #334155' }}>
                {user?.referral_code || 'LOADING...'}
              </strong>
            </div>
            <div>
              <span>Active 10% Boosted Slots: </span>
              <strong style={{ fontSize: '18px', color: '#22c55e', background: '#0f172a', padding: '6px 12px', borderRadius: '6px', border: '1px solid #334155' }}>
                {user?.boosted_slots || 0} Slots
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* PARTNER-ONLY SECTIONS */}
      {user?.role !== 'admin' && (
        <>
          {localStorage.getItem('admin_token') ? (
            /* ADMIN READ-ONLY VIEW: QR CHANNELS, ACTIVE PACKAGES, WITHDRAWAL & DEPOSIT HISTORY (NO INPUT FORMS) */
            <>
              {/* OFFICIAL QR DEPOSIT CHANNELS */}
              <div className="card full-width" style={{ marginBottom: '20px', background: 'rgba(34, 197, 94, 0.05)', border: '1px solid #22c55e' }}>
                <h3>📱 Scan to Deposit (Official QR Channels)</h3>
                <p className="muted" style={{ margin: '0 0 15px 0' }}>
                  Official active QR channels available for partner deposits:
                </p>
                <div className="grid-layout">
                  {paymentMethods.length === 0 ? (
                    <p className="muted">No active QR channels available right now.</p>
                  ) : (
                    paymentMethods.map(m => (
                      <div key={m.id} style={{ background: '#0f172a', padding: '15px', borderRadius: '8px', border: '1px solid #334155', textAlign: 'center' }}>
                        <h4 style={{ color: '#22c55e', margin: '0 0 10px 0' }}>{m.channel_name}</h4>
                        <div>
                          <button 
                            type="button"
                            onClick={() => setViewingProofImage(m.qr_image_url)}
                            style={{ background: '#22c55e', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', marginBottom: '8px', width: '100%' }}
                          >
                            🔍 View QR Code
                          </button>
                        </div>
                        {m.instructions && <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>{m.instructions}</p>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* ACTIVE PACKAGES & WITHDRAWAL HISTORY */}
              <div className="grid-layout">
                <div className="card">
                  <h3>Active Packages</h3>
                  {dashboard.packages?.length > 0 ? (
                    <>
                      <div style={{ background: 'rgba(14, 165, 233, 0.1)', border: '1px solid #0ea5e9', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px', fontSize: '13px', color: '#38bdf8' }}>
                        ℹ️ <strong>Payout Term:</strong> Each package generates daily revenue for exactly <strong>10 days (10x payouts)</strong> independently, and includes <strong>10% & 5%</strong> referral commission slots.
                      </div>
                      <div className="deposit-history-container" style={{ maxHeight: '100px' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Package</th>
                              <th>Daily Rate</th>
                              <th>Days Left</th>
                              <th>10% Slots</th>
                              <th>5% Slots</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashboard.packages.map((pkg) => (
                              <tr key={pkg.id}>
                                <td><strong>₱{parseFloat(pkg.tier).toLocaleString()} Tier</strong></td>
                                <td>₱{parseFloat(pkg.daily_revenue).toFixed(2)}</td>
                                <td>
                                  <span style={{ color: pkg.remaining_days > 0 ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                                    {pkg.remaining_days} / 10 days
                                  </span>
                                </td>
                                <td><span className={`badge ${pkg.boosted_slots > 0 ? 'approved' : 'pending'}`}>{pkg.boosted_slots} LEFT</span></td>
                                <td><span className={`badge ${pkg.commission_slots_5pct > 0 ? 'approved' : 'pending'}`}>{pkg.commission_slots_5pct} LEFT</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>This partner has no active packages.</p>
                  )}
                </div>

                <div className="card">
                  <h3>Withdrawal History</h3>
                  <div className="deposit-history-container" style={{ maxHeight: '200px' }}>
                    <table>
                      <thead>
                        <tr><th>Amount</th><th>Destination</th><th>Status</th><th>Proof</th></tr>
                      </thead>
                      <tbody>
                        {dashboard.withdrawals?.length === 0 ? (
                          <tr><td colSpan="4" className="muted" style={{ textAlign: 'center' }}>No withdrawal requests yet.</td></tr>
                        ) : (
                          dashboard.withdrawals?.map(w => (
                            <tr key={w.id}>
                              <td>₱{parseFloat(w.amount).toLocaleString()}</td>
                              <td style={{ fontSize: '12px', color: '#94a3b8' }}>{w.payout_details}</td>
                              <td><span className={`badge ${w.status}`}>{w.status}</span></td>
                              <td>
                                {w.status === 'approved' && w.proof_image ? (
                                  <button 
                                    onClick={() => setViewingProofImage(w.proof_image)}
                                    style={{ background: '#0ea5e9', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                  >
                                    🖼️ View SS
                                  </button>
                                ) : (
                                  <span className="muted" style={{ fontSize: '12px' }}>—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* DEPOSIT HISTORY */}
              <div className="card full-width">
                <h3>Deposit History</h3>
                <div className="deposit-history-container" style={{ maxHeight: '200px' }}>
                  <table>
                    <thead>
                      <tr><th>Amount</th><th>Ref</th><th>Status</th><th>Proof</th></tr>
                    </thead>
                    <tbody>
                      {dashboard.deposits?.length === 0 ? (
                        <tr><td colSpan="4" className="muted" style={{ textAlign: 'center' }}>No deposit requests yet.</td></tr>
                      ) : (
                        dashboard.deposits?.map(d => (
                          <tr key={d.id}>
                            <td>₱{parseFloat(d.amount).toLocaleString()}</td>
                            <td>{d.reference_no}</td>
                            <td><span className={`badge ${d.status}`}>{d.status}</span></td>
                            <td>
                              {d.proof_image ? (
                                <button 
                                  onClick={() => setViewingProofImage(d.proof_image)}
                                  style={{ background: '#0ea5e9', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                >
                                  🖼️ View SS
                                </button>
                              ) : (
                                <span className="muted" style={{ fontSize: '12px' }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            /* REGULAR PARTNER VIEW (WITH FULL SUBMISSION FORMS & PACKAGES TABLE) */
            <>
              {/* OFFICIAL QR DEPOSIT CHANNELS */}
              <div className="card full-width" style={{ marginBottom: '20px', background: 'rgba(34, 197, 94, 0.05)', border: '1px solid #22c55e' }}>
                <h3>📱 Scan to Deposit (Official QR Channels)</h3>
                <p className="muted" style={{ margin: '0 0 15px 0' }}>
                  Click a channel to view its exact QR code before making your transfer, then submit your reference number and payment screenshot below:
                </p>
                <div className="grid-layout">
                  {paymentMethods.length === 0 ? (
                    <p className="muted">No active QR channels available right now.</p>
                  ) : (
                    paymentMethods.map(m => (
                      <div key={m.id} style={{ background: '#0f172a', padding: '15px', borderRadius: '8px', border: '1px solid #334155', textAlign: 'center' }}>
                        <h4 style={{ color: '#22c55e', margin: '0 0 10px 0' }}>{m.channel_name}</h4>
                        <div>
                          <button 
                            type="button"
                            onClick={() => setViewingProofImage(m.qr_image_url)}
                            style={{ background: '#22c55e', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', marginBottom: '8px', width: '100%' }}
                          >
                            🔍 View QR Code
                          </button>
                        </div>
                        {m.instructions && <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>{m.instructions}</p>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* PACKAGE SELECTION SECTION */}
              <div className="card full-width" style={{ marginBottom: '30px' }}>
                <h3>Investment Package Tiers (Stacking Allowed)</h3>
                <p className="muted">
                  Purchase packages to stack your daily earnings and earn <strong>+3 Boosted 10% Referral Slots</strong> for your invitees' first purchases:
                </p>
                
                {packageError && (
                  <div className="error-box" style={{ marginTop: '15px', marginBottom: '15px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '12px', borderRadius: '6px' }}>
                    ⚠️ {packageError}
                  </div>
                )}

                <div className="grid-layout" style={{ marginTop: '15px' }}>
                  <div className="package-box">
                    <h4>₱500 Package Tier</h4>
                    <p>Daily Revenue: <strong>₱30.00 / day</strong></p>
                    <p style={{ fontSize: '13px', color: '#22c55e' }}>🎁 Grants +3 Boosted 10% Slots</p>
                    <button onClick={() => selectPackage(500)} className="btn-primary">Buy ₱500 Tier</button>
                  </div>
                  <div className="package-box">
                    <h4>₱1,000 Package Tier</h4>
                    <p>Daily Revenue: <strong>₱70.00 / day</strong></p>
                    <p style={{ fontSize: '13px', color: '#22c55e' }}>🎁 Grants +3 Boosted 10% Slots</p>
                    <button onClick={() => selectPackage(1000)} className="btn-primary">Buy ₱1,000 Tier</button>
                  </div>
                </div>
              </div>

              <div className="grid-layout">
                <div className="card">
                  <h3>Submit New Deposit</h3>
                  <form onSubmit={submitDeposit}>
                    <input type="number" step="0.01" placeholder="Amount (₱)" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} required />
                    <input type="text" placeholder="Reference No. / Note" value={refNo} onChange={e => setRefNo(e.target.value)} required />
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '5px' }}>Attach Transfer Proof Screenshot:</label>
                      <input type="file" accept="image/jpeg, image/png, image/webp" onChange={handleDepositProofUpload} required style={{ color: '#fff', fontSize: '13px' }} />
                      {depositProof && <span style={{ color: '#22c55e', fontSize: '12px', display: 'block', marginTop: '4px' }}>✓ Screenshot Ready</span>}
                    </div>
                    <button type="submit" className="btn-success">Submit Deposit Request</button>
                  </form>
                </div>

                <div className="card">
                  <h3>My Purchased Packages</h3>
                  {dashboard.packages?.length > 0 ? (
                    <>
                      <div style={{ background: 'rgba(14, 165, 233, 0.1)', border: '1px solid #0ea5e9', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px', fontSize: '13px', color: '#38bdf8' }}>
                        ℹ️ <strong>Payout Term:</strong> Each package generates daily revenue for exactly <strong>10 days (10x payouts)</strong> independently, and includes <strong>10% & 5%</strong> referral commission slots.
                      </div>
                      <div className="deposit-history-container" style={{ maxHeight: '200px' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Package</th>
                              <th>Daily Rate</th>
                              <th>Days Left</th>
                              <th>10% Slots</th>
                              <th>5% Slots</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashboard.packages.map((pkg) => (
                              <tr key={pkg.id}>
                                <td><strong>₱{parseFloat(pkg.tier).toLocaleString()} Tier</strong></td>
                                <td>₱{parseFloat(pkg.daily_revenue).toFixed(2)}</td>
                                <td>
                                  <span style={{ color: pkg.remaining_days > 0 ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                                    {pkg.remaining_days} / 10 days
                                  </span>
                                </td>
                                <td><span className={`badge ${pkg.boosted_slots > 0 ? 'approved' : 'pending'}`}>{pkg.boosted_slots} LEFT</span></td>
                                <td><span className={`badge ${pkg.commission_slots_5pct > 0 ? 'approved' : 'pending'}`}>{pkg.commission_slots_5pct} LEFT</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>You haven't purchased any packages yet. Select a tier above to start earning!</p>
                  )}
                </div>
              </div>

              <div className="grid-layout">
                <div className="card">
                  <h3>Request Withdrawal</h3>
                  <form onSubmit={submitWithdrawal}>
                    <input type="number" step="0.01" placeholder="Withdrawal Amount (₱)" value={withdrawalAmount} onChange={e => setWithdrawalAmount(e.target.value)} required />
                    <input type="text" placeholder="Your GCash / Bank Name & Account No." value={payoutDetails} onChange={e => setPayoutDetails(e.target.value)} required />
                    <button type="submit" className="btn-warning">Submit Withdrawal Request</button>
                  </form>
                </div>

                <div className="card">
                  <h3>My Withdrawal History</h3>
                  <div className="deposit-history-container" style={{ maxHeight: '200px' }}>
                    <table>
                      <thead>
                        <tr><th>Amount</th><th>Destination</th><th>Status</th><th>Proof</th></tr>
                      </thead>
                      <tbody>
                        {dashboard.withdrawals?.length === 0 ? (
                          <tr><td colSpan="4" className="muted" style={{ textAlign: 'center' }}>No withdrawal requests yet.</td></tr>
                        ) : (
                          dashboard.withdrawals?.map(w => (
                            <tr key={w.id}>
                              <td>₱{parseFloat(w.amount).toLocaleString()}</td>
                              <td style={{ fontSize: '12px', color: '#94a3b8' }}>{w.payout_details}</td>
                              <td><span className={`badge ${w.status}`}>{w.status}</span></td>
                              <td>
                                {w.status === 'approved' && w.proof_image ? (
                                  <button 
                                    onClick={() => setViewingProofImage(w.proof_image)}
                                    style={{ background: '#0ea5e9', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                  >
                                    🖼️ View SS
                                  </button>
                                ) : (
                                  <span className="muted" style={{ fontSize: '12px' }}>—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="card full-width">
                <h3>My Deposit History</h3>
                <div className="deposit-history-container" style={{ maxHeight: '200px' }}>
                  <table>
                    <thead>
                      <tr><th>Amount</th><th>Ref</th><th>Status</th><th>Proof</th></tr>
                    </thead>
                    <tbody>
                      {dashboard.deposits?.length === 0 ? (
                        <tr><td colSpan="4" className="muted" style={{ textAlign: 'center' }}>No deposit requests yet.</td></tr>
                      ) : (
                        dashboard.deposits?.map(d => (
                          <tr key={d.id}>
                            <td>₱{parseFloat(d.amount).toLocaleString()}</td>
                            <td>{d.reference_no}</td>
                            <td><span className={`badge ${d.status}`}>{d.status}</span></td>
                            <td>
                              {d.proof_image ? (
                                <button 
                                  onClick={() => setViewingProofImage(d.proof_image)}
                                  style={{ background: '#0ea5e9', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                >
                                  🖼️ View SS
                                </button>
                              ) : (
                                <span className="muted" style={{ fontSize: '12px' }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ADMIN PANEL */}
      {user?.role === 'admin' && !localStorage.getItem('admin_token') && (
        <div className="admin-section">
          <h2>Admin Management Panel</h2>

          {/* 1. PENDING DEPOSITS REVIEW (TOP FULL-WIDTH) */}
          <div className="card full-width" style={{ marginBottom: '20px', border: '2px solid #22c55e' }}>
            <h3>⚡ Pending Deposits Review (Priority)</h3>
            {adminData.pendingDeposits.length === 0 ? <p className="muted">No pending deposits.</p> : (
              <div className="deposit-history-container" style={{ maxHeight: '250px' }}>
                <table>
                  <thead>
                    <tr><th>Partner</th><th>Amount</th><th>Ref</th><th>Proof</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {adminData.pendingDeposits.map(d => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td>₱{parseFloat(d.amount).toLocaleString()}</td>
                        <td>{d.reference_no}</td>
                        <td>
                          {d.proof_image ? (
                            <button 
                              onClick={() => setViewingProofImage(d.proof_image)}
                              style={{ background: '#0ea5e9', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                            >
                              🖼️ View SS
                            </button>
                          ) : (
                            <span className="muted" style={{ fontSize: '12px' }}>—</span>
                          )}
                        </td>
                        <td>
                          <button onClick={() => handleDepositDecision(d.id, 'approved')} className="btn-sm approve">Approve</button>
                          <button onClick={() => handleDepositDecision(d.id, 'rejected')} className="btn-sm reject">Reject</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 2. PENDING WITHDRAWALS REVIEW (FULL-WIDTH WITH PROPER SPACING) */}
          <div className="card full-width" style={{ marginBottom: '20px' }}>
            <h3>Pending Withdrawals Review</h3>
            {adminData.pendingWithdrawals?.length === 0 ? <p className="muted">No pending withdrawals.</p> : (
              <div className="deposit-history-container" style={{ maxHeight: '260px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '18%' }}>Partner</th>
                      <th style={{ width: '15%' }}>Amount</th>
                      <th style={{ width: '22%' }}>Destination</th>
                      <th style={{ width: '25%' }}>Proof</th>
                      <th style={{ width: '20%' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminData.pendingWithdrawals?.map(w => (
                      <tr key={w.id}>
                        <td>{w.name}</td>
                        <td>₱{parseFloat(w.amount).toLocaleString()}</td>
                        <td><code style={{ color: '#38bdf8', wordBreak: 'break-all' }}>{w.payout_details}</code></td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <input 
                              type="file" 
                              accept="image/jpeg, image/png, image/webp" 
                              onChange={(e) => handleWithdrawalProofUpload(w.id, e)}
                              style={{ fontSize: '11px', width: '100%', color: '#fff' }}
                            />
                            {withdrawalProofs[w.id] && <span style={{ color: '#22c55e', fontSize: '11px', fontWeight: 'bold' }}>✓ Ready</span>}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '5px' }}>
                            <button onClick={() => handleWithdrawalDecision(w.id, 'approved')} className="btn-sm approve">Approve</button>
                            <button onClick={() => handleWithdrawalDecision(w.id, 'rejected')} className="btn-sm reject">Reject</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3. APPROVED DEPOSITS HISTORY (FULL-WIDTH SCROLLABLE) */}
          <div className="card full-width" style={{ marginBottom: '20px' }}>
            <h3>Approved Deposits History</h3>
            {adminData.approvedDeposits?.length === 0 ? <p className="muted">No deposit history records.</p> : (
              <div className="deposit-history-container" style={{ maxHeight: '250px' }}>
                <table>
                  <thead>
                    <tr><th>Partner</th><th>Amount</th><th>Ref</th><th>Proof</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {adminData.approvedDeposits?.map(d => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td>₱{parseFloat(d.amount).toLocaleString()}</td>
                        <td>{d.reference_no}</td>
                        <td>
                          {d.proof_image ? (
                            <button 
                              onClick={() => setViewingProofImage(d.proof_image)}
                              style={{ background: '#0ea5e9', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                            >
                              🖼️ View SS
                            </button>
                          ) : (
                            <span className="muted" style={{ fontSize: '12px' }}>—</span>
                          )}
                        </td>
                        <td>
                          <button onClick={() => deleteDepositHistory(d.id)} className="btn-sm reject">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* COMPACT MANAGE QR CHANNELS SECTION */}
          <div className="card full-width" style={{ marginTop: '20px' }}>
            <h3>Manage Official QR Deposit Channels</h3>
            <div style={{ marginTop: '15px' }} className="grid-layout">
              <form onSubmit={handleAddPaymentMethod} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input type="text" placeholder="Channel Name (e.g., GCash QR)" value={channelName} onChange={e => setChannelName(e.target.value)} required />
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '3px' }}>Upload Cropped QR Image:</label>
                  <input type="file" accept="image/jpeg, image/png, image/webp" onChange={handleQrFileUpload} required style={{ color: '#fff', fontSize: '12px' }} />
                </div>
                <input type="text" placeholder="Instructions (e.g., Scan QR and input ref no.)" value={qrInstructions} onChange={e => setQrInstructions(e.target.value)} />
                <button type="submit" className="btn-success" style={{ padding: '8px' }}>Add QR Channel</button>
              </form>

              <div style={{ background: '#0f172a', padding: '12px', borderRadius: '8px', border: '1px solid #334155' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#22c55e', fontSize: '14px' }}>Active QR Channels</h4>
                {paymentMethods.length === 0 ? <p className="muted" style={{ fontSize: '13px' }}>No QR channels created yet.</p> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto' }}>
                    {paymentMethods.map(m => (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: '8px 12px', borderRadius: '6px', border: '1px solid #334155' }}>
                        <div>
                          <span style={{ fontWeight: 'bold', color: '#22c55e', fontSize: '13px' }}>{m.channel_name}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button 
                            type="button"
                            onClick={() => setViewingProofImage(m.qr_image_url)}
                            style={{ background: '#0ea5e9', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
                          >
                            🔍 View QR
                          </button>
                          <button onClick={() => handleDeletePaymentMethod(m.id)} className="btn-sm reject" style={{ padding: '4px 8px', fontSize: '11px' }}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ADMIN BALANCE TOP-UP */}
          <div className="card full-width" style={{ marginTop: '20px' }}>
            <h3>Top Up Admin Balance</h3>
            <p className="muted">Manually add funds to the admin balance when needed and log the entry in ledger history.</p>
            <form onSubmit={handleAdminTopUp} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Top-Up Amount (₱)"
                value={topUpAmount}
                onChange={e => setTopUpAmount(e.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Note (Optional, e.g., Liquidity top-up)"
                value={topUpNote}
                onChange={e => setTopUpNote(e.target.value)}
              />
              <button type="submit" className="btn-success">Add to Admin Balance</button>
            </form>
          </div>

          <div className="card full-width" style={{ marginTop: '20px' }}>
            <h3>Automated Daily Tier Payouts</h3>
            <p className="muted">Credit daily revenue yields to active partner subscriptions (blocked if admin balance is lower than total payout).</p>
            <button onClick={distributeTierRevenue} className="btn-warning" style={{ marginTop: '10px' }}>
              Trigger Daily Revenue Payout
            </button>
          </div>

          <div className="card full-width" style={{ marginTop: '20px' }}>
            <h3>Partners Overview</h3>
            <div className="deposit-history-container" style={{ maxHeight: '220px' }}>
              <table>
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Package Tier</th><th>Daily Revenue</th><th>Ref Code</th><th>Boosted Slots</th><th>Balance</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {adminData.partners.map(p => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.email}</td>
                      <td>{p.package_tier > 0 ? `₱${p.package_tier} Tier` : 'None'}</td>
                      <td>₱{p.daily_revenue} / day</td>
                      <td><code>{p.referral_code}</code></td>
                      <td>{p.boosted_slots} slots</td>
                      <td>₱{parseFloat(p.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td>
                        <button
                          className="btn-sm"
                          style={{ backgroundColor: '#0ea5e9', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer' }}
                          onClick={async () => {
                            try {
                              const currentAdminToken = localStorage.getItem('token');
                              const res = await axios.post(`${API_URL}/admin/impersonate/${p.id}`, {}, {
                                headers: { Authorization: `Bearer ${currentAdminToken}` }
                              });
                              localStorage.setItem('admin_token', currentAdminToken);
                              localStorage.setItem('token', res.data.token);
                              window.location.reload();
                            } catch (err) {
                              alert(err.response?.data?.error || 'Failed to switch view.');
                            }
                          }}
                        >
                          View Dashboard
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* IMAGE / RECEIPT / QR PREVIEW MODAL */}
      {viewingProofImage && (
        <div 
          onClick={() => setViewingProofImage(null)}
          style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#1e293b', padding: '20px', borderRadius: '10px', maxWidth: '500px', width: '100%', textAlign: 'center', border: '1px solid #334155' }}
          >
            <h3 style={{ marginTop: 0, color: '#fff' }}>Image Preview</h3>
            <img 
              src={viewingProofImage} 
              alt="QR Preview" 
              style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: '6px', marginBottom: '15px', background: '#fff', padding: '10px' }} 
            />
            <br />
            <button 
              onClick={() => setViewingProofImage(null)}
              style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
