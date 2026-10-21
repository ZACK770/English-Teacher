"""Telephone purchases: PBX collects cards; only signed settlement grants minutes."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from html import unescape

from fastapi import Header, HTTPException, Query, Request

from .business import Package, now

PREFIX = "dibura-"


def safe_message(value):
    text = unescape(re.sub(r"<[^>]*>", " ", str(value)))
    text = re.sub(r"(?:\d[ -]?){8,}", "[פרטים הוסתרו]", text)
    text = re.sub(r"(?i)(cvv\s*[:=]?\s*)\d{3,4}", r"\1[הוסתר]", text)
    return " ".join(text.split())[:500]


def provider_rows(settings, action, last_id):
    body = urllib.parse.urlencode(
        {
            "Action": action,
            "MosadId": settings.nedarim_mosad_id,
            "ApiPassword": settings.nedarim_api_key.get_secret_value(),
            "LastId": last_id,
            "MaxId": 2000,
        }
    ).encode()
    request = urllib.request.Request(
        "https://matara.pro/nedarimplus/Reports/Manage3.aspx", data=body
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read(4_000_001))
        if not isinstance(data, list) or len(data) > 2000:
            raise ValueError("Unexpected provider response")
        return data
    except Exception:
        raise ValueError("לא ניתן לקרוא את דוח נדרים פלוס כרגע") from None


def agorot(value):
    try:
        number = Decimal(str(value))
        if not number.is_finite() or number <= 0 or number * 100 != (number * 100).to_integral():
            raise ValueError("Invalid payment amount")
        return int(number * 100)
    except (InvalidOperation, TypeError):
        raise ValueError("Invalid payment amount") from None


def configured(settings):
    return bool(
        settings.nedarim_phone_enabled
        and re.fullmatch(r"[0-9]{7}", settings.nedarim_mosad_id)
        and settings.nedarim_api_key
        and settings.nedarim_webhook_secret
        and settings.nedarim_phone_terminal
    )


def verify_signature(raw, headers, secret, current_time=None):
    timestamp = headers.get("x-nedarim-timestamp", "")
    signature = headers.get("x-nedarim-signature", "")
    if not re.fullmatch(r"[0-9]{1,12}", timestamp):
        return False
    if abs((time.time() if current_time is None else current_time) - int(timestamp)) > 300:
        return False
    expected = (
        "v1="
        + hmac.new(secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    )
    return hmac.compare_digest(expected, signature)


class PaymentStore:
    def __init__(self, business):
        self.business = business

    def initialize(self):
        with self.business.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS payment_orders (
                    id TEXT PRIMARY KEY, call_id TEXT NOT NULL UNIQUE,
                    customer_id TEXT NOT NULL, package_id TEXT NOT NULL,
                    snapshot TEXT NOT NULL, amount_agorot INTEGER NOT NULL,
                    vat_rate REAL NOT NULL, state TEXT NOT NULL,
                    confirmation TEXT NOT NULL DEFAULT '',
                    transaction_id TEXT UNIQUE, receipt_id TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS payment_issues (
                    id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
                    kind TEXT NOT NULL, message TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    created_at TEXT NOT NULL, resolved_at TEXT,
                    resolution TEXT NOT NULL DEFAULT '');
                CREATE TABLE IF NOT EXISTS payment_sync (
                    action TEXT PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0,
                    attempted_at REAL NOT NULL DEFAULT 0, completed_at TEXT,
                    last_error TEXT NOT NULL DEFAULT '');
            """)

    def issue_for_data(self, data, kind, message):
        category = str(data.get("Groupe", ""))
        order_id = category[len(PREFIX) :] if category.startswith(PREFIX) else ""
        if not re.fullmatch(r"[0-9a-f]{32}", order_id):
            return False
        clean = (
            safe_message(message)
            if kind != "settlement_review"
            else ("אי התאמה באישור התשלום, זיכוי או ביטול. יש לבדוק את העסקה מול נדרים פלוס.")
        )
        fingerprint = hashlib.sha256(
            json.dumps(
                [order_id, kind, clean, str(data.get("TransactionId", ""))], ensure_ascii=False
            ).encode()
        ).hexdigest()
        with self.business.connect() as db:
            if not db.execute("SELECT 1 FROM payment_orders WHERE id=?", (order_id,)).fetchone():
                return False
            db.execute(
                """INSERT OR IGNORE INTO payment_issues
                (id,order_id,kind,message,created_at) VALUES (?,?,?,?,?)""",
                (fingerprint, order_id, kind, clean, now()),
            )
        return True

    def refusal(self, data, mosad_id):
        if str(data.get("MosadNumber", "")) != mosad_id:
            raise ValueError("Wrong institution")
        if str(data.get("Status", "")).lower() != "error":
            raise ValueError("Invalid refusal")
        if not self.issue_for_data(data, "refusal", data.get("Message", "החיוב סורב")):
            return {"ignored": True}
        order_id = str(data["Groupe"])[len(PREFIX) :]
        with self.business.connect() as db:
            # A late refusal must never erase a previously confirmed successful payment.
            db.execute(
                """UPDATE payment_orders SET state='failed',updated_at=? WHERE id=?
                AND state IN ('issued','awaiting_settlement')""",
                (now(), order_id),
            )
        return {"recorded": True}

    def resolve_issue(self, issue_id, note):
        note = safe_message(note)
        if not note:
            raise ValueError("יש לציין מה נעשה לטיפול בבעיה")
        with self.business.connect() as db:
            result = db.execute(
                """UPDATE payment_issues SET status='resolved',resolved_at=?,resolution=?
                WHERE id=? AND status='open'""",
                (now(), note, issue_id),
            )
            if result.rowcount:
                db.execute(
                    "INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)",
                    ("payment:issue_resolved", issue_id, now()),
                )
        return {"resolved": bool(result.rowcount)}

    def reconcile(self, settings):
        if not settings.nedarim_api_key:
            raise ValueError("מפתח נדרים אינו מוגדר")
        report = {}
        for action, id_field in (("GetHistoryJson", "TransactionId"), ("GetErrorLogsJson", "ID")):
            with self.business.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("INSERT OR IGNORE INTO payment_sync(action) VALUES (?)", (action,))
                state = db.execute(
                    "SELECT * FROM payment_sync WHERE action=?", (action,)
                ).fetchone()
                if time.time() - state["attempted_at"] < 180:
                    report[action] = {"limited": True}
                    continue
                cursor = state["last_id"]
                db.execute(
                    "UPDATE payment_sync SET attempted_at=? WHERE action=?", (time.time(), action)
                )
            try:
                rows = provider_rows(settings, action, cursor)
                matched = 0
                for row in rows:
                    if not isinstance(row, dict) or not str(row.get(id_field, "")).isdigit():
                        raise ValueError("מבנה דוח הספק אינו תקין")
                    event = {**row, "MosadNumber": settings.nedarim_mosad_id}
                    if action == "GetErrorLogsJson":
                        event.update(Status="Error", Message=row.get("Error", "החיוב סורב"))
                        result = self.refusal(event, settings.nedarim_mosad_id)
                    else:
                        try:
                            result = self.settle(event, settings.nedarim_mosad_id)
                        except (ValueError, sqlite3.IntegrityError) as exc:
                            self.issue_for_data(event, "settlement_review", str(exc))
                            result = {"review": True}
                    matched += not result.get("ignored", False)
                    cursor = max(cursor, int(row[id_field]))
                    with self.business.connect() as db:
                        db.execute(
                            "UPDATE payment_sync SET last_id=? WHERE action=?", (cursor, action)
                        )
                with self.business.connect() as db:
                    db.execute(
                        "UPDATE payment_sync SET completed_at=?,last_error='' WHERE action=?",
                        (now(), action),
                    )
                report[action] = {
                    "received": len(rows),
                    "matched": matched,
                    "more": len(rows) == 2000,
                }
            except ValueError as exc:
                message = safe_message(str(exc))
                with self.business.connect() as db:
                    db.execute(
                        "UPDATE payment_sync SET last_error=? WHERE action=?", (message, action)
                    )
                report[action] = {"error": message}
        return report

    def order_for_call(self, call_id):
        with self.business.connect() as db:
            row = db.execute("SELECT * FROM payment_orders WHERE call_id=?", (call_id,)).fetchone()
        return dict(row) if row else None

    def cancel_selection(self, call_id):
        with self.business.connect() as db:
            db.execute(
                "UPDATE payment_orders SET state='cancelled',updated_at=? "
                "WHERE call_id=? AND state='selected'",
                (now(), call_id),
            )

    def overview(self, settings, offset=0, limit=50, customer_id="", state="", search=""):
        customers = {c["id"]: c for c in self.business.list("customers")}
        with self.business.connect() as db:
            orders = [
                dict(r)
                for r in db.execute("SELECT * FROM payment_orders ORDER BY created_at DESC,id DESC")
            ]
            receipts = [dict(r) for r in db.execute("SELECT * FROM sales_receipts")]
            issues = [
                dict(r)
                for r in db.execute("SELECT * FROM payment_issues ORDER BY created_at DESC,id DESC")
            ]
            sync = [dict(r) for r in db.execute("SELECT * FROM payment_sync ORDER BY action")]
        summaries = {
            key: {
                "has_paid": False,
                "paid_ils": 0,
                "verified_ils": 0,
                "manual_ils": 0,
                "latest_state": "none",
                "open_issues": 0,
            }
            for key in customers
        }
        verified_total = 0
        manual_total = 0
        for receipt in receipts:
            verified = receipt["reference"].startswith("nedarim:")
            amount = receipt["amount_ils"]
            if verified:
                verified_total += amount
            else:
                manual_total += amount
            summary = summaries.get(receipt["customer_id"])
            if summary is not None:
                summary["paid_ils"] += amount
                summary["verified_ils" if verified else "manual_ils"] += amount
                summary["has_paid"] = summary["paid_ils"] > 0
        by_order = {o["id"]: o for o in orders}
        for issue in issues:
            order = by_order.get(issue["order_id"], {})
            customer = customers.get(order.get("customer_id"), {})
            package = json.loads(order["snapshot"]) if order else {}
            issue.update(
                customer_id=order.get("customer_id"),
                customer_name=customer.get("name"),
                customer_phone=customer.get("phone"),
                package_name=package.get("name"),
            )
            summary = summaries.get(order.get("customer_id"))
            if summary is not None and issue["status"] == "open":
                summary["open_issues"] += 1
        counts = {}
        pending = 0
        stale = 0
        for order in orders:
            counts[order["state"]] = counts.get(order["state"], 0) + 1
            package = json.loads(order.pop("snapshot"))
            customer = customers.get(order["customer_id"], {})
            order.update(
                package_name=package["name"],
                product=package["product"],
                customer_name=customer.get("name", "לקוח לא זמין"),
                customer_phone=customer.get("phone", ""),
            )
            summary = summaries.get(order["customer_id"])
            if summary is not None and summary["latest_state"] == "none":
                summary["latest_state"] = order["state"]
            order["pending_review"] = (
                order["state"] in ("issued", "awaiting_settlement")
                and (
                    datetime.now(UTC) - datetime.fromisoformat(order["updated_at"])
                ).total_seconds()
                > 900
            )
            stale += order["pending_review"]
            if order["state"] in ("issued", "awaiting_settlement"):
                pending += order["amount_agorot"] / 100
            order.pop("call_id")
        filtered = [
            o
            for o in orders
            if (not customer_id or o["customer_id"] == customer_id)
            and (not state or o["state"] == state)
            and (
                not search
                or search.casefold()
                in (o["customer_name"] + " " + o["customer_phone"] + " " + o["id"]).casefold()
            )
        ]
        return {
            "configured": configured(settings),
            "mosad_id": settings.nedarim_mosad_id,
            "phone_terminal": settings.nedarim_phone_terminal,
            "orders": filtered[offset : offset + limit],
            "total": len(filtered),
            "offset": offset,
            "limit": limit,
            "counts": counts,
            "issues": [i for i in issues if not customer_id or i["customer_id"] == customer_id][
                :100
            ],
            "open_issues": sum(i["status"] == "open" for i in issues),
            "customer_summaries": summaries,
            "totals": {
                "verified_ils": round(verified_total, 2),
                "manual_ils": round(manual_total, 2),
                "pending_ils": round(pending, 2),
                "pending_review": stale,
            },
            "sync": sync,
            "settlement": "signed_webhook_or_authenticated_history",
        }

    def create(self, call_id, customer_id, package_id, allow_hidden=False):
        if customer_id.startswith("anonymous-"):
            raise ValueError("A recognized caller is required")
        with self.business.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM payment_orders WHERE call_id=?", (call_id,)
            ).fetchone()
            if existing:
                if existing["customer_id"] != customer_id:
                    raise ValueError("Customer mismatch")
                return dict(existing)
            row = db.execute(
                "SELECT body FROM console_records WHERE kind='packages' AND id=?", (package_id,)
            ).fetchone()
            customer = db.execute(
                "SELECT 1 FROM console_records WHERE kind='customers' AND id=?", (customer_id,)
            ).fetchone()
            if not row or not customer:
                raise ValueError("Unknown customer or package")
            package = Package.model_validate_json(row[0])
            if not package.active or (not allow_hidden and not package.phone_enabled):
                raise ValueError("Inactive package")
            amount = agorot(package.price_ils)
            order_id = secrets.token_hex(16)
            db.execute(
                """INSERT INTO payment_orders
                (id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,
                 state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'selected',?,?)""",
                (
                    order_id,
                    call_id,
                    customer_id,
                    package_id,
                    package.model_dump_json(),
                    amount,
                    self.business.economics().vat_rate,
                    now(),
                    now(),
                ),
            )
            return dict(
                db.execute("SELECT * FROM payment_orders WHERE id=?", (order_id,)).fetchone()
            )

    def issue(self, call_id):
        """Only the first confirmed callback may issue a charge instruction."""
        with self.business.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute(
                """UPDATE payment_orders SET state='issued',updated_at=?
                WHERE call_id=? AND state='selected' AND created_at>?""",
                (now(), call_id, (datetime.now(UTC) - timedelta(minutes=30)).isoformat()),
            )
            return result.rowcount == 1

    def record_pbx_result(self, call_id, status, confirmation):
        # A PBX OK is informational; it never creates a receipt or grants access.
        with self.business.connect() as db:
            db.execute(
                """UPDATE payment_orders SET state=?,confirmation=?,updated_at=?
                WHERE call_id=? AND state='issued'""",
                (
                    "awaiting_settlement" if status == "OK" else "failed",
                    str(confirmation)[:100],
                    now(),
                    call_id,
                ),
            )
            order = db.execute(
                "SELECT id FROM payment_orders WHERE call_id=?", (call_id,)
            ).fetchone()
        if order and status != "OK":
            self.issue_for_data(
                {"Groupe": PREFIX + order["id"]},
                "pbx_failure",
                "הפעולה בקו הסתיימה ללא אישור: ביטול, סירוב או תקלה.",
            )

    def settle(self, data, mosad_id):
        """Caller MUST authenticate the provider before calling this method."""
        if str(data.get("MosadNumber", "")) != mosad_id:
            raise ValueError("Wrong institution")
        if data.get("Status") not in (None, "", "OK"):
            return {"ignored": True}
        category = str(data.get("Groupe", ""))
        if not category.startswith(PREFIX):
            return {"ignored": True}
        order_id = category[len(PREFIX) :]
        if not re.fullmatch(r"[0-9a-f]{32}", order_id):
            return {"ignored": True}
        transaction_id = str(data.get("TransactionId", ""))
        confirmation = str(data.get("Confirmation", ""))
        if (
            not re.fullmatch(r"[0-9]{1,30}", transaction_id)
            or not confirmation
            or len(confirmation) > 100
            or str(data.get("Currency", "")) != "1"
            or str(data.get("KevaId", "")) not in ("", "0")
        ):
            raise ValueError("Invalid settlement")
        amount = agorot(data.get("Amount"))
        with self.business.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            order = db.execute("SELECT * FROM payment_orders WHERE id=?", (order_id,)).fetchone()
            if not order:
                return {"ignored": True}
            if amount != order["amount_agorot"]:
                raise ValueError("Payment amount mismatch")
            if order["state"] == "paid":
                if order["transaction_id"] != transaction_id:
                    raise ValueError("Additional transaction requires review")
                return {"paid": True, "receipt_id": order["receipt_id"], "duplicate": True}
            if order["state"] not in ("issued", "awaiting_settlement", "failed"):
                raise ValueError("Order was not confirmed")
            if order["confirmation"] and confirmation != order["confirmation"]:
                raise ValueError("Confirmation mismatch")
            package = Package.model_validate_json(order["snapshot"])
            receipt_id = secrets.token_hex(10)
            expires = (datetime.now(UTC) + timedelta(days=package.validity_days)).isoformat()
            reference = "nedarim:" + mosad_id + ":" + transaction_id
            db.execute(
                "INSERT INTO sales_receipts VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    receipt_id,
                    order["customer_id"],
                    order["package_id"],
                    package.product,
                    reference,
                    amount / 100,
                    order["vat_rate"],
                    package.minutes,
                    expires,
                    now(),
                ),
            )
            db.execute(
                """UPDATE payment_orders SET state='paid',transaction_id=?,
                confirmation=?,receipt_id=?,updated_at=? WHERE id=?""",
                (transaction_id, confirmation, receipt_id, now(), order_id),
            )
            db.execute(
                """UPDATE payment_issues SET status='resolved',resolved_at=?,
                resolution='התשלום אושר מול הסולק' WHERE order_id=? AND status='open'
                AND kind IN ('refusal','pbx_failure')""",
                (now(), order_id),
            )
            db.execute(
                "INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)",
                ("payment:nedarim_verified", order_id, now()),
            )
            return {"paid": True, "receipt_id": receipt_id}


def selection_menu(name, text, keys="0,9"):
    return {
        "type": "simpleMenu",
        "name": name,
        "enabledKeys": keys,
        "times": 2,
        "timeout": 10,
        "errorReturn": "ERROR",
        "post": True,
        "files": [{"text": text}],
    }


def payment_response(store, settings, params, customer_id, package_ids):
    """Called only after PBX callback authentication and project-path verification."""
    call_id = params["PBXcallId"]
    order = store.order_for_call(call_id)
    # Process a success result even when the caller disconnected immediately afterward.
    if order and params.get("isaacPayStatus"):
        store.record_pbx_result(
            call_id, params["isaacPayStatus"], params.get("CONFIRM_isaacPayStatus", "")
        )
        order = store.order_for_call(call_id)
    if params.get("PBXcallStatus") == "HANGUP":
        store.cancel_selection(call_id)
        return {"type": "hangup"}
    if params.get("isaacPayExit") in ("0", "9", "ERROR"):
        return {
            "type": "goTo",
            "goTo": settings.tlivr_project_path + ("/4" if params["isaacPayExit"] == "9" else ""),
            "removeParams": ["isaacPackage", "isaacPayConfirm", "isaacPayExit", "isaacSales"],
        }
    if not configured(settings):
        return selection_menu(
            "isaacPayExit", "התשלום הטלפוני אינו זמין כרגע. לשירות הקישו 9. לחזרה הקישו 0."
        )
    if customer_id.startswith("anonymous-"):
        return selection_menu(
            "isaacPayExit", "לרכישת חבילה יש להתקשר ממספר גלוי. לשירות הקישו 9. לחזרה הקישו 0."
        )
    if order:
        state = order["state"]
        if state == "paid":
            return selection_menu(
                "isaacPayExit", "התשלום אושר והחבילה נפתחה עבורכם. לחזרה הקישו 0. לשירות הקישו 9."
            )
        if state != "selected":
            message = (
                "התשלום לא אושר או שהרכישה בוטלה."
                if state in ("failed", "cancelled")
                else "ממתינים לאישור חברת הסליקה. "
                "החבילה תיפתח אוטומטית לאחר קבלת האישור. אין לבצע תשלום נוסף."
            )
            return selection_menu("isaacPayExit", message + " לחזרה הקישו 0. לשירות הקישו 9.")
        if params.get("isaacPayConfirm") in ("0", "ERROR"):
            store.cancel_selection(call_id)
            return {
                "type": "goTo",
                "goTo": settings.tlivr_project_path,
                "removeParams": ["isaacPackage", "isaacPayConfirm", "isaacSales"],
            }
        package = Package.model_validate_json(order["snapshot"])
        if params.get("isaacPayConfirm") == "1":
            if not store.issue(call_id):
                return selection_menu(
                    "isaacPayExit", "הבקשה כבר בטיפול או פג תוקפה. לחזרה הקישו 0. לשירות הקישו 9."
                )
            return {
                "type": "creditCard",
                "name": "isaacPayStatus",
                "post": True,
                "sum": order["amount_agorot"] / 100,
                "sumChangeable": "no",
                "payments": 1,
                "paymentsMode": "regular",
                "cvv": "yes",
                "tz": "yes",
                "terminal": settings.nedarim_phone_terminal,
                "category": PREFIX + order["id"],
                "noFailExit": "no",
                "noSuccess": "yes",
                "noConfirmation": "yes",
            }
        text = (
            f"בחרתם {package.name}. החבילה כוללת {package.minutes} דקות, "
            f"בתוקף ל-{package.validity_days} ימים, במחיר {order['amount_agorot'] / 100:g} שקלים. "
            "לתשלום חד פעמי באשראי הקישו 1. לביטול הקישו 0."
        )
        return selection_menu("isaacPayConfirm", text, "0,1")
    choice = params.get("isaacPackage", "")
    if choice in ("0", "9", "ERROR"):
        return {
            "type": "goTo",
            "goTo": settings.tlivr_project_path + ("/4" if choice == "9" else ""),
            "removeParams": ["isaacPackage", "isaacSales"],
        }
    if choice.isdigit() and 1 <= int(choice) <= len(package_ids):
        try:
            store.create(call_id, customer_id, package_ids[int(choice) - 1])
        except ValueError:
            return selection_menu(
                "isaacPayExit", "החבילה אינה זמינה לרכישה. לחזרה הקישו 0. לשירות הקישו 9."
            )
        return payment_response(store, settings, params, customer_id, package_ids)
    packages = {p["id"]: p for p in store.business.list("packages")}
    lines = []
    for index, package_id in enumerate(package_ids, 1):
        package = packages.get(package_id)
        if (
            package
            and package["active"]
            and package["price_ils"] > 0
            and package.get("phone_enabled", True)
        ):
            product = "בית הספר" if package["product"] == "school" else "התרגומון"
            lines.append(
                f"לחבילת {product}, {package['name']}, "
                f"במחיר {package['price_ils']:g} שקלים, הקישו {index}."
            )
    if not lines:
        return selection_menu(
            "isaacPayExit", "החבילות עדיין אינן פתוחות לרכישה. לשירות הקישו 9. לחזרה הקישו 0."
        )
    return selection_menu(
        "isaacPackage",
        " ".join(lines) + " לשירות הקישו 9. לחזרה הקישו 0.",
        ",".join(["0", "9"] + [str(i) for i in range(1, len(package_ids) + 1)]),
    )


def install_payment_api(app, require_admin):
    @app.post("/v1/admin/payments/test-order")
    async def test_order(body: dict, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if not configured(app.state.settings):
            raise HTTPException(409, "חיבור הסליקה אינו פעיל")
        business = app.state.business
        package_id = str(body.get("package_id", ""))
        customer_id = str(body.get("customer_id", ""))
        packages = await asyncio.to_thread(business.list, "packages")
        package = next((p for p in packages if p["id"] == package_id), None)
        if not package or not package["active"] or agorot(package["price_ils"]) > 100:
            raise HTTPException(422, "בדיקת סליקה מוגבלת לחבילה פעילה עד שקל אחד")
        call_id = "admin-test-" + secrets.token_hex(16)
        try:
            order = await asyncio.to_thread(
                app.state.payments.create, call_id, customer_id, package_id, True
            )
            if not await asyncio.to_thread(app.state.payments.issue, call_id):
                raise ValueError("לא ניתן לפתוח בקשת בדיקה")
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        return {
            "order_id": order["id"],
            "category": PREFIX + order["id"],
            "amount_ils": order["amount_agorot"] / 100,
            "mosad_id": app.state.settings.nedarim_mosad_id,
        }

    @app.post("/v1/payments/nedarim/webhook")
    async def webhook(request: Request):
        settings = app.state.settings
        if not settings.nedarim_webhook_secret:
            raise HTTPException(503, "Payments unavailable")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 65536:
                raise HTTPException(413, "Webhook too large")
        if not verify_signature(
            bytes(raw), request.headers, settings.nedarim_webhook_secret.get_secret_value()
        ):
            raise HTTPException(401, "Invalid signature")
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("Invalid settlement")
            if str(data.get("Status", "")).lower() == "error":
                return await asyncio.to_thread(
                    app.state.payments.refusal, data, settings.nedarim_mosad_id
                )
            try:
                return await asyncio.to_thread(
                    app.state.payments.settle, data, settings.nedarim_mosad_id
                )
            except (ValueError, sqlite3.IntegrityError):
                if str(data.get("MosadNumber", "")) == settings.nedarim_mosad_id:
                    await asyncio.to_thread(
                        app.state.payments.issue_for_data, data, "settlement_review", ""
                    )
                raise
        except (ValueError, TypeError, sqlite3.IntegrityError):
            raise HTTPException(400, "Settlement requires review") from None

    @app.get("/v1/admin/payments/status")
    async def payment_status(
        authorization: str | None = Header(default=None),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=50, ge=1, le=200),
        customer_id: str = "",
        state: str = "",
        search: str = "",
    ):
        require_admin(authorization)
        s = app.state.settings
        return await asyncio.to_thread(
            app.state.payments.overview, s, offset, limit, customer_id, state, search
        )

    @app.post("/v1/admin/payments/reconcile")
    async def reconcile(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return await asyncio.to_thread(app.state.payments.reconcile, app.state.settings)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None

    @app.post("/v1/admin/payments/issues/{issue_id}/resolve")
    async def resolve(issue_id: str, body: dict, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return await asyncio.to_thread(
                app.state.payments.resolve_issue, issue_id, str(body.get("note", ""))[:1000]
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
