import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { Package, Receipt, PaymentOrder, PaymentIssue } from '../../types';
import { CreditCard, Plus, RefreshCw, CheckCircle, AlertTriangle, Search, Filter } from 'lucide-react';

export const PackagesView: React.FC = () => {
  const {
    packages,
    receipts,
    paymentOrders,
    paymentIssues,
    customers,
    createPackage,
    recordManualReceipt,
    reconcileNedarimPayments,
    resolvePaymentIssue,
    showToast
  } = useApp();

  const [showNewPkgModal, setShowNewPkgModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);

  // Filter & Search
  const [stateFilter, setStateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // New Package Form
  const [pkgName, setPkgName] = useState('');
  const [pkgProduct, setPkgProduct] = useState<'school' | 'translator'>('school');
  const [pkgMinutes, setPkgMinutes] = useState(100);
  const [pkgPrice, setPkgPrice] = useState(220);
  const [pkgValidity, setPkgValidity] = useState(30);

  // New Receipt Form
  const [receiptCustomer, setReceiptCustomer] = useState(customers[0]?.id || '');
  const [receiptPackage, setReceiptPackage] = useState(packages[0]?.id || '');
  const [receiptRef, setReceiptRef] = useState('');
  const [receiptAmount, setReceiptAmount] = useState(220);

  // Resolve issue modal
  const [resolvingIssueId, setResolvingIssueId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  const filteredOrders = paymentOrders.filter(o => {
    const matchesState = stateFilter ? o.state === stateFilter : true;
    const matchesSearch = searchQuery
      ? o.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) || o.customer_phone.includes(searchQuery)
      : true;
    return matchesState && matchesSearch;
  });

  const verifiedIls = receipts.filter(r => r.reference.startsWith('nedarim:')).reduce((acc, r) => acc + r.amount_ils, 0);
  const manualIls = receipts.filter(r => !r.reference.startsWith('nedarim:')).reduce((acc, r) => acc + r.amount_ils, 0);
  const openIssues = paymentIssues.filter(i => i.status === 'open');

  const handleCreatePackage = (e: React.FormEvent) => {
    e.preventDefault();
    createPackage({
      name: pkgName,
      product: pkgProduct,
      minutes: pkgMinutes,
      price_ils: pkgPrice,
      validity_days: pkgValidity,
      active: true,
      phone_enabled: true
    });
    setShowNewPkgModal(false);
    setPkgName('');
  };

  const handleCreateReceipt = (e: React.FormEvent) => {
    e.preventDefault();
    recordManualReceipt(receiptCustomer, receiptPackage, receiptRef, receiptAmount);
    setShowReceiptModal(false);
    setReceiptRef('');
  };

  const handleReconcile = async () => {
    setIsReconciling(true);
    try {
      await reconcileNedarimPayments();
    } finally {
      setIsReconciling(false);
    }
  };

  const handleResolveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingIssueId) return;
    resolvePaymentIssue(resolvingIssueId, resolveNote);
    setResolvingIssueId(null);
    setResolveNote('');
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">מרכז הניהול / חבילות ותשלומים</span>
          <h1 className="text-2xl font-black text-[#172b35] flex items-center gap-2">
            <span>חבילות ותשלומי נדרים פלוס</span>
          </h1>
          <p className="text-xs text-[#718087] mt-1">
            מחירים כוללים מע״מ. תשלום שנרשם יוצר זכאות עם דקות שיחה ותאריך תפוגה.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReceiptModal(true)}
            className="bg-white border border-[#e3e8eb] hover:bg-[#fafbfc] text-[#172b35] px-4 py-2 rounded-xl text-xs font-bold transition"
          >
            רישום תשלום ידני
          </button>
          <button
            onClick={() => setShowNewPkgModal(true)}
            className="bg-[#137c69] hover:bg-[#0f6656] text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>חבילה חדשה</span>
          </button>
        </div>
      </div>

      {/* Package Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {packages.map(pkg => (
          <div key={pkg.id} className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-xs bg-[#e9f5f0] text-[#137c69] font-bold px-2 py-0.5 rounded">
                  {pkg.product === 'school' ? 'בית הספר' : 'תרגומון'}
                </span>
                <span className="text-xs text-[#718087]">תוקף: {pkg.validity_days} ימים</span>
              </div>
              <h3 className="font-extrabold text-lg text-[#172b35] mb-2">{pkg.name}</h3>
              <div className="text-3xl font-black text-[#172b35] tabular-nums mb-2">
                ₪{pkg.price_ils}
              </div>
              <p className="text-xs text-[#718087]">
                {pkg.minutes} דקות שיחה מלאות בקו ובאתר.
              </p>
            </div>

            <div className="pt-4 border-t border-[#f0f3f4] mt-4 flex items-center justify-between text-xs">
              <span className="text-[#137c69] font-semibold">
                {pkg.phone_enabled ? '● זמינה בטלפון' : '○ באתר בלבד'}
              </span>
              <button
                onClick={() => showToast(`החבילה "${pkg.name}" פעילה בקו ובסליקה.`)}
                className="bg-[#fafbfc] border border-[#e3e8eb] hover:bg-white text-[#172b35] px-3.5 py-1.5 rounded-xl font-bold transition"
              >
                הגדרות
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Nedarim Plus Collection Panel */}
      <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e3e8eb] pb-4">
          <div>
            <h2 className="text-lg font-bold text-[#172b35] flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#137c69]" />
              <span>מעקב גבייה וסליקת נדרים פלוס</span>
            </h2>
            <p className="text-xs text-[#718087] mt-0.5">
              כל התקופות • תשלומים מאושרים, ניסיונות רכישה ובעיות לטיפול.
            </p>
          </div>

          <button
            onClick={handleReconcile}
            disabled={isReconciling}
            className="bg-[#fafbfc] hover:bg-[#e9f5f0] border border-[#e3e8eb] text-[#137c69] px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
            <span>{isReconciling ? 'בודק עסקאות מול נדרים פלוס...' : 'בדיקת התאמה מול נדרים פלוס'}</span>
          </button>
        </div>

        {/* Collection Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-[#102d32] text-white rounded-xl">
            <span className="text-[11px] text-[#acc0bf] block">תקבולי נדרים מאומתים</span>
            <span className="text-2xl font-black text-[#dceab7] tabular-nums block mt-1">₪{verifiedIls.toLocaleString()}</span>
            <span className="text-[10px] text-[#8ca4a6] block mt-0.5">נכללים אוטומטית בדוחות</span>
          </div>

          <div className="p-4 bg-[#fafbfc] border border-[#e3e8eb] rounded-xl">
            <span className="text-[11px] text-[#718087] block">רישומים ידניים</span>
            <span className="text-2xl font-black text-[#172b35] tabular-nums block mt-1">₪{manualIls.toLocaleString()}</span>
            <span className="text-[10px] text-[#718087] block mt-0.5">נפרדים מאימות הסולק</span>
          </div>

          <div className="p-4 bg-[#fafbfc] border border-[#e3e8eb] rounded-xl">
            <span className="text-[11px] text-[#718087] block">ממתינים לסולק</span>
            <span className="text-2xl font-black text-[#93661e] tabular-nums block mt-1">
              {paymentOrders.filter(o => o.state === 'awaiting_settlement').length}
            </span>
            <span className="text-[10px] text-[#718087] block mt-0.5">לא נכלל בהכנסה עד אישור</span>
          </div>

          <div className="p-4 bg-[#fafbfc] border border-[#e3e8eb] rounded-xl">
            <span className="text-[11px] text-[#718087] block">בעיות גבייה פתוחות</span>
            <span className="text-2xl font-black text-[#b83b49] tabular-nums block mt-1">{openIssues.length}</span>
            <span className="text-[10px] text-[#718087] block mt-0.5">דורשות מענה ובירור</span>
          </div>
        </div>

        {/* Filters Toolbar */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <select
            value={stateFilter}
            onChange={e => setStateFilter(e.target.value)}
            className="p-2 rounded-xl border border-[#e3e8eb] bg-[#fafbfc] text-xs font-semibold"
          >
            <option value="">כל המצבים</option>
            <option value="paid">שולם ואומת</option>
            <option value="awaiting_settlement">ממתין לאישור הסולק</option>
            <option value="failed">לא אושר</option>
            <option value="cancelled">בוטל</option>
          </select>

          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="חיפוש לפי שם או טלפון..."
            className="p-2 rounded-xl border border-[#e3e8eb] bg-[#fafbfc] text-xs min-w-[240px]"
          />
        </div>

        {/* Orders Table */}
        <div className="overflow-x-auto border border-[#e3e8eb] rounded-xl">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-[#f5f6f8] text-[#718087] border-b border-[#e3e8eb]">
                <th className="py-2.5 px-3 font-bold">מועד</th>
                <th className="py-2.5 px-3 font-bold">לקוח</th>
                <th className="py-2.5 px-3 font-bold">טלפון</th>
                <th className="py-2.5 px-3 font-bold">חבילה ומוצר</th>
                <th className="py-2.5 px-3 font-bold">סכום</th>
                <th className="py-2.5 px-3 font-bold">מצב</th>
                <th className="py-2.5 px-3 font-bold">מספר עסקה בסולק</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f3f4]">
              {filteredOrders.map(order => (
                <tr key={order.id} className="hover:bg-[#fafbfc]">
                  <td className="py-3 px-3 text-[#718087]">{new Date(order.created_at).toLocaleString('he-IL')}</td>
                  <td className="py-3 px-3 font-bold text-[#172b35]">{order.customer_name}</td>
                  <td className="py-3 px-3 font-mono" dir="ltr">{order.customer_phone}</td>
                  <td className="py-3 px-3 font-semibold text-[#172b35]">{order.package_name}</td>
                  <td className="py-3 px-3 font-black tabular-nums">₪{(order.amount_agorot / 100).toFixed(2)}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      order.state === 'paid'
                        ? 'bg-[#e9f5f0] text-[#137c69]'
                        : order.state === 'awaiting_settlement'
                        ? 'bg-[#fff4df] text-[#93661e]'
                        : 'bg-[#fff0ee] text-[#b83b49]'
                    }`}>
                      {order.state === 'paid' ? 'שולם ואומת' : order.state === 'awaiting_settlement' ? 'ממתין לסולק' : order.state}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-[#718087]">{order.transaction_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Open Issues Section */}
        {openIssues.length > 0 && (
          <div className="pt-4 border-t border-[#f0f3f4]">
            <h3 className="font-bold text-sm text-[#172b35] mb-3">בעיות גבייה הדורשות טיפול</h3>
            <div className="space-y-2">
              {openIssues.map(issue => (
                <div key={issue.id} className="p-3.5 bg-[#fff8e9] border border-[#f5dfb8] rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-[#172b35]">{issue.customer_name} ({issue.customer_phone})</span>
                    <p className="text-slate-700 mt-0.5">{issue.message}</p>
                  </div>
                  <button
                    onClick={() => setResolvingIssueId(issue.id)}
                    className="bg-white border border-[#e4b55d] text-[#725018] px-3 py-1 rounded-lg font-bold hover:bg-[#fff4df]"
                  >
                    תיעוד טיפול
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* New Package Modal */}
      {showNewPkgModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#e3e8eb] shadow-xl max-w-md w-full p-6 text-right" dir="rtl">
            <h3 className="font-bold text-lg text-[#172b35] mb-4">יצירת חבילת לימוד חדשה</h3>
            <form onSubmit={handleCreatePackage} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#718087] block mb-1">שם החבילה:</label>
                <input
                  type="text"
                  required
                  value={pkgName}
                  onChange={e => setPkgName(e.target.value)}
                  placeholder="למשל: מסלול מקיף · 200 דקות"
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-[#718087] block mb-1">מוצר:</label>
                  <select
                    value={pkgProduct}
                    onChange={e => setPkgProduct(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                  >
                    <option value="school">בית הספר</option>
                    <option value="translator">תרגומון</option>
                  </select>
                </div>
                <div>
                  <label className="font-bold text-[#718087] block mb-1">דקות בחבילה:</label>
                  <input
                    type="number"
                    value={pkgMinutes}
                    onChange={e => setPkgMinutes(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-[#718087] block mb-1">מחיר כולל מע״מ (ש״ח):</label>
                  <input
                    type="number"
                    value={pkgPrice}
                    onChange={e => setPkgPrice(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                  />
                </div>
                <div>
                  <label className="font-bold text-[#718087] block mb-1">תוקף בימים:</label>
                  <input
                    type="number"
                    value={pkgValidity}
                    onChange={e => setPkgValidity(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewPkgModal(false)}
                  className="px-4 py-2 rounded-xl font-semibold text-[#718087]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] text-white px-5 py-2 rounded-xl font-bold shadow-sm"
                >
                  שמור חבילה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Receipt Modal */}
      {showReceiptModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#e3e8eb] shadow-xl max-w-md w-full p-6 text-right" dir="rtl">
            <h3 className="font-bold text-lg text-[#172b35] mb-2">רישום תשלום שהתקבל</h3>
            <p className="text-xs text-[#718087] mb-4">
              מיועד לתשלום שהתקבל מחוץ למערכת (העברה בנקאית, מזומן). רישום ידני מזכה את הלקוח בדקות באופן מיידי.
            </p>
            <form onSubmit={handleCreateReceipt} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#718087] block mb-1">בחר לקוח:</label>
                <select
                  value={receiptCustomer}
                  onChange={e => setReceiptCustomer(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                >
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">חבילה נרכשת:</label>
                <select
                  value={receiptPackage}
                  onChange={e => {
                    setReceiptPackage(e.target.value);
                    const p = packages.find(pkg => pkg.id === e.target.value);
                    if (p) setReceiptAmount(p.price_ils);
                  }}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                >
                  {packages.map(p => (
                    <option key={p.id} value={p.id}>{p.name} (₪{p.price_ils})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-[#718087] block mb-1">אסמכתה / מס׳ אישור:</label>
                  <input
                    type="text"
                    required
                    value={receiptRef}
                    onChange={e => setReceiptRef(e.target.value)}
                    placeholder="למשל: BANK-123"
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                  />
                </div>
                <div>
                  <label className="font-bold text-[#718087] block mb-1">סכום ששולם (ש״ח):</label>
                  <input
                    type="number"
                    value={receiptAmount}
                    onChange={e => setReceiptAmount(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReceiptModal(false)}
                  className="px-4 py-2 rounded-xl font-semibold text-[#718087]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] text-white px-5 py-2 rounded-xl font-bold shadow-sm"
                >
                  רשום תשלום והטען דקות
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Issue Modal */}
      {resolvingIssueId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#e3e8eb] shadow-xl max-w-md w-full p-6 text-right" dir="rtl">
            <h3 className="font-bold text-lg text-[#172b35] mb-2">תיעוד טיפול בבעיית גבייה</h3>
            <form onSubmit={handleResolveSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#718087] block mb-1">מה נעשה לטיפול?</label>
                <textarea
                  rows={3}
                  required
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                  placeholder="למשל: יצרנו קשר עם הלקוחה, העסקה חויבה ידנית והחבילה הוטענה."
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResolvingIssueId(null)}
                  className="px-4 py-2 rounded-xl font-semibold text-[#718087]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] text-white px-5 py-2 rounded-xl font-bold shadow-sm"
                >
                  שמור וסגור בעיה
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
