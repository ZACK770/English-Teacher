import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { Customer } from '../../types';
import { Users, Plus, Search, ExternalLink, PhoneCall, Copy, Check, FileText } from 'lucide-react';

export const CustomersView: React.FC = () => {
  const { customers, bots, receipts, detailedCalls, saveCustomer, createCustomer, generateCustomerInvite, showToast } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  // New customer form state
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newSource, setNewSource] = useState('direct_admin');
  const [newBot, setNewBot] = useState('shochi-robot');
  const [newNotes, setNewNotes] = useState('');

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.includes(searchQuery)
  );

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const customerReceipts = selectedCustomer ? receipts.filter(r => r.customer_id === selectedCustomer.id) : [];
  const customerCalls = selectedCustomer ? detailedCalls.filter(c => c.customer_id === selectedCustomer.id) : [];

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;

    createCustomer({
      name: newName,
      phone: newPhone,
      source: newSource,
      preferred_bot: newBot,
      notes: newNotes
    });

    setShowNewModal(false);
    setNewName('');
    setNewPhone('');
    setNewNotes('');
  };

  const handleOpenInvite = (customerId: string) => {
    const url = generateCustomerInvite(customerId);
    setInviteUrl(url);
    navigator.clipboard.writeText(url);
    showToast('קישור הכניסה האישי לאזור התלמיד הועתק ללוח!');
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">מרכז הניהול / לקוחות</span>
          <h1 className="text-2xl font-black text-[#172b35] flex items-center gap-2">
            <span>הלקוחות שלך (CRM)</span>
          </h1>
          <p className="text-xs text-[#718087] mt-1">
            חשבון נפרד לכל אדם, ללא תלות בבוט או במורה שנבחר. הפקת קישורי כניסה אישיים לאתר.
          </p>
        </div>

        <button
          onClick={() => setShowNewModal(true)}
          className="bg-[#137c69] hover:bg-[#0f6656] text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>הוספת לקוח חדש</span>
        </button>
      </div>

      {/* Search Toolbar */}
      <div className="bg-white border border-[#e3e8eb] rounded-2xl p-4 shadow-xs flex items-center gap-3">
        <Search className="w-4 h-4 text-[#718087]" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="חיפוש לקוח לפי שם או מספר טלפון..."
          className="w-full text-xs bg-transparent focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-[#e3e8eb] rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-[#f5f6f8] text-[#718087] border-b border-[#e3e8eb]">
                <th className="py-3 px-4 font-bold">שם הלקוח</th>
                <th className="py-3 px-4 font-bold">טלפון</th>
                <th className="py-3 px-4 font-bold">מצב תשלום</th>
                <th className="py-3 px-4 font-bold">מקור הגעה</th>
                <th className="py-3 px-4 font-bold">מורה מועדף</th>
                <th className="py-3 px-4 font-bold">עודכן</th>
                <th className="py-3 px-4 font-bold">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f3f4]">
              {filteredCustomers.map(c => {
                const preferredBotObj = bots.find(b => b.id === c.preferred_bot);
                return (
                  <tr key={c.id} className="hover:bg-[#fafbfc] transition">
                    <td className="py-3.5 px-4 font-bold text-[#172b35]">{c.name}</td>
                    <td className="py-3.5 px-4 tabular-nums font-mono text-[#718087]" dir="ltr">{c.phone}</td>
                    <td className="py-3.5 px-4">
                      {c.has_paid ? (
                        <span className="bg-[#e9f5f0] text-[#137c69] font-bold px-2 py-0.5 rounded text-[11px]">
                          שולם • ₪{c.paid_ils}
                        </span>
                      ) : (
                        <div className="flex flex-col gap-1 items-start">
                          <span className="bg-[#f5f6f8] text-[#718087] px-2 py-0.5 rounded text-[11px]">
                            חבילת מתנה 20 דק'
                          </span>
                          <span className="bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded text-[10px]">
                            🔥 ליד חם לשדרוג
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-[#718087]">{c.source}</td>
                    <td className="py-3.5 px-4 font-medium text-[#172b35]">
                      {preferredBotObj?.label || 'לא נבחר'}
                    </td>
                    <td className="py-3.5 px-4 text-[#718087]">{new Date(c.updated_at).toLocaleDateString('he-IL')}</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedCustomerId(c.id)}
                          className="bg-[#fafbfc] border border-[#e3e8eb] hover:bg-[#e9f5f0] text-[#172b35] hover:text-[#137c69] px-3 py-1 rounded-lg font-semibold transition"
                        >
                          תיק לקוח
                        </button>
                        <button
                          onClick={() => handleOpenInvite(c.id)}
                          className="p-1 text-[#718087] hover:text-[#6d5ce7] transition"
                          title="הפקת קישור הזמנה אישי לאתר"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Detail Drawer / Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#e3e8eb] shadow-2xl max-w-2xl w-full p-6 text-right max-h-[90vh] overflow-y-auto" dir="rtl">
            <div className="flex items-center justify-between border-b border-[#e3e8eb] pb-4 mb-4">
              <div>
                <span className="text-xs font-bold text-[#137c69] block">תיק לקוח CRM</span>
                <h2 className="text-xl font-bold text-[#172b35] mt-0.5">{selectedCustomer.name}</h2>
              </div>
              <button
                onClick={() => setSelectedCustomerId(null)}
                className="text-[#718087] hover:text-[#172b35] text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6 text-xs">
              {/* Quick Invite Box */}
              <div className="p-4 bg-[#f7f5ff] border border-[#e8e7f2] rounded-2xl flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-bold text-[#6d5ce7] block">קישור כניסה אישי לאזור התלמיד:</span>
                  <p className="text-[#718087] mt-0.5 text-[11px]">
                    קישור ייחודי המאפשר לתלמיד לצפות בתמלילים, להעלות חומרים ולשחק במשחקונים.
                  </p>
                </div>
                <button
                  onClick={() => handleOpenInvite(selectedCustomer.id)}
                  className="bg-[#6d5ce7] text-white px-3.5 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>העתק קישור אישי</span>
                </button>
              </div>

              {/* Hot Lead Upsell Action Box */}
              <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-extrabold text-amber-900 block">
                    🔥 מנוע המרה ושדרוג (Nedarim Plus + CRM מרחב)
                  </span>
                  <p className="text-amber-800 mt-0.5 text-[11px]">
                    הלקוח זכאי להצעה: חבילת 100 דקות ב-220 ₪ או 300 דקות ב-550 ₪.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`https://nedar.im/pay/school?customer=${selectedCustomer.id}&phone=${selectedCustomer.phone}&pkg=pkg_school_100`);
                      showToast('קישור סליקת נדרים פלוס הועתק ללוח!');
                    }}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-xl font-bold transition text-[11px]"
                  >
                    העתק קישור סליקה
                  </button>
                  <button
                    onClick={() => {
                      showToast(`הופעלה שיחת מכירה משוכי (שלוחה 99/3) למספר ${selectedCustomer.phone}!`);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 text-[11px]"
                  >
                    <PhoneCall className="w-3 h-3" />
                    <span>שיחת מכירה משוכי</span>
                  </button>
                </div>
              </div>

              {/* Balances */}
              <div>
                <h3 className="font-bold text-sm text-[#172b35] mb-2">יתרות בחבילות שיחה</h3>
                {customerReceipts.length === 0 ? (
                  <p className="text-[#718087]">אין חבילות רשומות ללקוח זה.</p>
                ) : (
                  <div className="space-y-2">
                    {customerReceipts.map(r => (
                      <div key={r.id} className="p-3 bg-[#fafbfc] border border-[#e3e8eb] rounded-xl flex items-center justify-between">
                        <div>
                          <span className="font-bold text-[#172b35] block">{r.product === 'school' ? 'בית הספר' : 'תרגומון'}</span>
                          <span className="text-[11px] text-[#718087]">תוקף עד {new Date(r.expires_at).toLocaleDateString('he-IL')}</span>
                        </div>
                        <span className="font-bold text-[#137c69] tabular-nums">
                          {Math.max(0, r.minutes - r.spent_seconds / 60).toFixed(1)} דקות נותרו
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Calls History */}
              <div>
                <h3 className="font-bold text-sm text-[#172b35] mb-2">שיחות אחרונות מתועדות</h3>
                {customerCalls.length === 0 ? (
                  <p className="text-[#718087]">טרם תועדו שיחות ללקוח זה.</p>
                ) : (
                  <div className="space-y-2">
                    {customerCalls.map(c => (
                      <div key={c.call_id} className="p-3 bg-[#fafbfc] border border-[#e3e8eb] rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-[#172b35]">{c.bot_name}</span>
                          <span className="text-[11px] text-[#718087]">{new Date(c.created_at).toLocaleString('he-IL')}</span>
                        </div>
                        <p className="text-slate-600 line-clamp-2">{c.summary_he}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <h3 className="font-bold text-sm text-[#172b35] mb-1">הערות ניהוליות:</h3>
                <p className="p-3 bg-[#fafbfc] border border-[#e3e8eb] rounded-xl text-slate-700 whitespace-pre-wrap">
                  {selectedCustomer.notes || 'אין הערות.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Customer Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#e3e8eb] shadow-xl max-w-md w-full p-6 text-right" dir="rtl">
            <h3 className="font-bold text-lg text-[#172b35] mb-4">הוספת לקוח חדש</h3>
            <form onSubmit={handleCreateCustomer} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#718087] block mb-1">שם הלקוח:</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                />
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">מספר טלפון:</label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  placeholder="050-0000000"
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-right"
                />
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">מורה מועדף:</label>
                <select
                  value={newBot}
                  onChange={e => setNewBot(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                >
                  {bots.map(b => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">הערות:</label>
                <textarea
                  rows={3}
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 rounded-xl font-semibold text-[#718087]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] text-white px-5 py-2 rounded-xl font-bold shadow-sm"
                >
                  הוסף לקוח
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
