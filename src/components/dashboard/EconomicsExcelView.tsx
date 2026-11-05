import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { INITIAL_EXCEL_ROWS } from '../../store/initialData';
import { Download, Calculator, TrendingUp, DollarSign, Layers, Check } from 'lucide-react';

export const EconomicsExcelView: React.FC = () => {
  const { economics, saveEconomics, showToast } = useApp();

  const [excelRows, setExcelRows] = useState(INITIAL_EXCEL_ROWS);
  const [totalLeads, setTotalLeads] = useState(1000);
  const [conversionRatePct, setConversionRatePct] = useState(8.5); // 8.5% conversion
  const [avgPackagePriceIls, setAvgPackagePriceIls] = useState(250);
  const [giftMinutesPerLead, setGiftMinutesPerLead] = useState(20);
  const [directCostPerMinuteIls, setDirectCostPerMinuteIls] = useState(0.18);
  const [fixedMonthlyCostIls, setFixedMonthlyCostIls] = useState(500);

  // Calculations
  const payingCustomers = Math.round((totalLeads * conversionRatePct) / 100);
  const grossRevenueIls = payingCustomers * avgPackagePriceIls;
  const giftAcquisitionCostIls = totalLeads * (giftMinutesPerLead * directCostPerMinuteIls * 0.4); // Assuming 40% activate gift
  const payingCallsUsageCostIls = payingCustomers * (100 * directCostPerMinuteIls); // 100 min per paying customer
  const totalVariableCostsIls = giftAcquisitionCostIls + payingCallsUsageCostIls;
  const totalCostsIls = totalVariableCostsIls + fixedMonthlyCostIls;
  const netProfitMonthlyIls = grossRevenueIls - totalCostsIls;
  const profitMarginPct = grossRevenueIls > 0 ? Math.round((netProfitMonthlyIls / grossRevenueIls) * 100) : 0;
  const cacPerPayingCustomer = payingCustomers > 0 ? Math.round(giftAcquisitionCostIls / payingCustomers) : 0;

  const exportCsv = () => {
    let csv = 'קטגוריה,רכיב עלות / הכנסה,עלות לדקה (ש״ח),עלות חודשית קבועה (ש״ח),הערות פדגוגיות וכלכליות\n';
    excelRows.forEach(r => {
      csv += `"${r.category}","${r.item}",${r.cost_per_minute_ils},${r.monthly_fixed_ils},"${r.notes}"\n`;
    });
    csv += `\nסימולציית רווחיות חודשית\n`;
    csv += `סה״כ לידים,${totalLeads}\n`;
    csv += `אחוז המרה למשלמים,${conversionRatePct}%\n`;
    csv += `לקוחות משלמים בפועל,${payingCustomers}\n`;
    csv += `הכנסות ברוטו חודשיות,${grossRevenueIls} ש״ח\n`;
    csv += `עלות חבילות מתנה (CAC),${giftAcquisitionCostIls.toFixed(2)} ש״ח\n`;
    csv += `עלויות משתנות ושיחות,${totalVariableCostsIls.toFixed(2)} ש״ח\n`;
    csv += `עלויות קבועות,${fixedMonthlyCostIls} ש״ח\n`;
    csv += `רווח נקי חודשי צפוי,${netProfitMonthlyIls.toFixed(2)} ש״ח (${profitMarginPct}% שולי רווח)\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `english_school_profit_model_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    showToast('קובץ האקסל יוצא בהצלחה כ-CSV.');
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">מודל עסקי ואקסל רווח</span>
          <h1 className="text-2xl font-black text-[#172b35] flex items-center gap-2">
            <span>אקסל עלויות בית הספר והערכת רווח</span>
          </h1>
          <p className="text-xs text-[#718087] mt-1">
            חישוב כלכלי שקוף ומדויק של עלויות טכנולוגיה ישירות (Gemini Live + Technoline), עלות חבילת המתנה ורווחיות צפויה.
          </p>
        </div>

        <button
          onClick={exportCsv}
          className="bg-[#102d32] hover:bg-[#1a454d] text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          <span>ייצוא נתוני האקסל ל-CSV</span>
        </button>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-[#e3e8eb] shadow-xs">
          <span className="text-xs text-[#718087] block">רווח חודשי נקי צפוי</span>
          <span className="text-2xl font-black text-[#137c69] tabular-nums block mt-1">
            ₪{netProfitMonthlyIls.toLocaleString()}
          </span>
          <span className="text-[11px] text-[#137c69] font-bold block mt-1">
            שולי רווח: {profitMarginPct}%
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#e3e8eb] shadow-xs">
          <span className="text-xs text-[#718087] block">הכנסות ברוטו מחבילות</span>
          <span className="text-2xl font-black text-[#172b35] tabular-nums block mt-1">
            ₪{grossRevenueIls.toLocaleString()}
          </span>
          <span className="text-[11px] text-[#718087] block mt-1">
            לפי {payingCustomers} משלמים (ממוצע ₪{avgPackagePriceIls})
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#e3e8eb] shadow-xs">
          <span className="text-xs text-[#718087] block">עלות חבילת מתנה ללקוח (CAC)</span>
          <span className="text-2xl font-black text-[#6d5ce7] tabular-nums block mt-1">
            ₪{cacPerPayingCustomer}
          </span>
          <span className="text-[11px] text-[#718087] block mt-1">
            עלות רכישה נמוכה ביותר הודות לרובוט!
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-[#e3e8eb] shadow-xs">
          <span className="text-xs text-[#718087] block">עלות טכנולוגיה כוללת לדקה</span>
          <span className="text-2xl font-black text-[#172b35] tabular-nums block mt-1">
            ₪{directCostPerMinuteIls}
          </span>
          <span className="text-[11px] text-[#718087] block mt-1">
            AI + קו טלפון + סליקה + שרת
          </span>
        </div>
      </div>

      {/* Interactive Simulation Controls */}
      <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs">
        <h3 className="font-bold text-base text-[#172b35] mb-4 flex items-center gap-2">
          <Calculator className="w-5 h-5 text-[#137c69]" />
          <span>מחשבון סימולציה מהיר (What-If Analysis)</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-xs">
          <div>
            <label className="font-bold text-[#718087] block mb-1">
              כמות לידים בדיוור / קמפיין:
            </label>
            <input
              type="number"
              value={totalLeads}
              onChange={e => setTotalLeads(Math.max(1, Number(e.target.value)))}
              className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm font-semibold"
            />
          </div>

          <div>
            <label className="font-bold text-[#718087] block mb-1">
              אחוז המרה למשלמים (%):
            </label>
            <input
              type="number"
              step="0.5"
              value={conversionRatePct}
              onChange={e => setConversionRatePct(Math.max(0.1, Number(e.target.value)))}
              className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm font-semibold"
            />
          </div>

          <div>
            <label className="font-bold text-[#718087] block mb-1">
              מחיר ממוצע לחבילה (ש״ח):
            </label>
            <input
              type="number"
              value={avgPackagePriceIls}
              onChange={e => setAvgPackagePriceIls(Math.max(10, Number(e.target.value)))}
              className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm font-semibold"
            />
          </div>

          <div>
            <label className="font-bold text-[#718087] block mb-1">
              עלות דקה טכנולוגית (ש״ח):
            </label>
            <input
              type="number"
              step="0.01"
              value={directCostPerMinuteIls}
              onChange={e => setDirectCostPerMinuteIls(Math.max(0.05, Number(e.target.value)))}
              className="w-full p-2.5 rounded-xl border border-[#e3e8eb] text-sm font-semibold"
            />
          </div>
        </div>
      </div>

      {/* The Excel Spreadsheet Matrix */}
      <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-base text-[#172b35] flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#137c69]" />
            <span>טבלת גיליון עלויות והכנסות (Cost & Profit Spreadsheet)</span>
          </h3>
          <span className="text-xs text-[#718087]">ערכים בש״ח כולל מע״מ</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-[#f5f6f8] text-[#718087] border-y border-[#e3e8eb]">
                <th className="py-3 px-4 font-bold">קטגוריית עלות / תקבול</th>
                <th className="py-3 px-4 font-bold">רכיב במערכת</th>
                <th className="py-3 px-4 font-bold">עלות לדקה (ש״ח)</th>
                <th className="py-3 px-4 font-bold">קבוע לחודש (ש״ח)</th>
                <th className="py-3 px-4 font-bold">הערות ותובנות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f3f4]">
              {excelRows.map((row, idx) => {
                const isRevenue = row.cost_per_minute_ils < 0;
                return (
                  <tr key={idx} className="hover:bg-[#fafbfc]">
                    <td className="py-3 px-4 font-semibold text-[#172b35]">{row.category}</td>
                    <td className="py-3 px-4 text-[#172b35]">{row.item}</td>
                    <td className="py-3 px-4 tabular-nums font-bold">
                      {isRevenue ? (
                        <span className="text-[#137c69]">+{Math.abs(row.cost_per_minute_ils).toFixed(2)} (הכנסה)</span>
                      ) : (
                        <span className="text-[#b83b49]">₪{row.cost_per_minute_ils.toFixed(3)}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-[#718087]">
                      {row.monthly_fixed_ils > 0 ? `₪${row.monthly_fixed_ils}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-[#718087] max-w-xs">{row.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
