"""Persistent operations console. Financial facts and forecasts are kept separate."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator


class Customer(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=5, max_length=40)
    source: str = Field(default="organic", max_length=80)
    preferred_bot: str = Field(default="", max_length=63)
    notes: str = Field(default="", max_length=2000)


class Package(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    product: Literal["school", "translator"]
    minutes: int = Field(ge=1, le=100000)
    price_ils: float = Field(ge=0, le=100000)
    validity_days: int = Field(default=30, ge=1, le=3650)
    active: bool = False
    phone_enabled: bool = True


class Receipt(BaseModel):
    customer_id: str
    package_id: str
    reference: str = Field(min_length=3, max_length=150)
    amount_ils: float = Field(ge=0, le=100000)


class Lesson(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    goal: str = Field(default="", max_length=1000)
    instructions: str = Field(default="", max_length=6000)
    passing_score: int = Field(default=3, ge=1, le=5)


class Course(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    level: str = Field(default="basic", max_length=60)
    bot_id: str = Field(default="", max_length=63)
    lessons: list[Lesson] = Field(default_factory=list, max_length=100)
    active: bool = False


class Enrollment(BaseModel):
    customer_id: str
    course_id: str
    lesson_index: int = Field(default=0, ge=0, le=99)
    status: Literal["active", "completed", "paused"] = "active"


class Narration(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    placement: Literal["welcome", "language_menu", "quota", "upsell", "service", "other"]
    text: str = Field(min_length=1, max_length=6000)
    language: str = Field(default="he-IL", max_length=20)
    bot_id: str = Field(default="", max_length=63)
    technoline_extension: str = Field(default="", max_length=150)
    status: Literal["draft", "approved"] = "draft"


class AccessPolicy(BaseModel):
    enabled: bool = False
    product: Literal["school", "translator"] = "school"
    free_calls_month: int = Field(default=0, ge=0, le=100)
    free_call_seconds: int = Field(default=60, ge=10, le=600)
    blocked_extension: str = Field(default="/", max_length=150)
    basic_enabled: bool = False
    basic_calls_day: int = Field(default=3, ge=0, le=50)
    basic_call_seconds: int = Field(default=120, ge=30, le=900)
    basic_month_seconds: int = Field(default=3000, ge=0, le=500000)
    basic_intro_text: str = Field(default="", max_length=400)

    @field_validator("blocked_extension")
    @classmethod
    def absolute_extension(cls, value):
        if not value.startswith("/"):
            raise ValueError("שלוחה צריכה להתחיל בלוכסן")
        return value


class Economics(BaseModel):
    vat_rate: float = Field(default=0.18, ge=0, le=0.5)
    usd_ils: float = Field(default=3.7, gt=0, le=20)
    fixed_monthly_ils: float = Field(default=0, ge=0)
    paid_marketing_ils: float = Field(default=0, ge=0)
    owner_hours_month: float = Field(default=30, ge=0, le=744)
    owner_hour_value: float = Field(default=0, ge=0)
    development_cash: float = Field(default=500, ge=0)
    development_self_work: float = Field(default=1500, ge=0)
    forecast_price_ils: float = Field(default=0, ge=0)
    forecast_minutes: float = Field(default=0, ge=0)
    forecast_cost_per_minute: float = Field(default=0, ge=0)
    forecast_payment_fee: float = Field(default=0, ge=0)
    forecast_lifetime_months: float = Field(default=0, ge=0)
    free_budget_ils: float = Field(default=0, ge=0)
    school_price_ils: float = Field(default=0, ge=0)
    school_minutes: float = Field(default=0, ge=0)
    school_minute_cost: float = Field(default=0, ge=0)
    translator_price_ils: float = Field(default=0, ge=0)
    translator_minutes: float = Field(default=0, ge=0)
    translator_minute_cost: float = Field(default=0, ge=0)


MODELS = {
    "customers": Customer, "packages": Package, "courses": Course,
    "enrollments": Enrollment, "narrations": Narration,
    "policies": AccessPolicy,
}


def now() -> str:
    return datetime.now(UTC).isoformat()


def normalized_phone(value: str) -> str:
    digits = "".join(c for c in value if c.isdigit())
    if digits.startswith("972"):
        digits = "0" + digits[3:]
    if len(digits) < 8 or len(digits) > 15:
        raise ValueError("נדרש מספר טלפון תקין")
    return digits


class BusinessStore:
    def __init__(self, path: Path):
        self.path = path

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        return db

    def initialize(self):
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS api_quota (
                    month TEXT NOT NULL, api TEXT NOT NULL, used INTEGER NOT NULL,
                    PRIMARY KEY (month, api));
                CREATE TABLE IF NOT EXISTS console_records (
                    kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    PRIMARY KEY(kind,id));
                CREATE TABLE IF NOT EXISTS customer_phones (
                    phone TEXT PRIMARY KEY, customer_id TEXT NOT NULL UNIQUE);
                CREATE TABLE IF NOT EXISTS call_customers (
                    call_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
                    bot_id TEXT NOT NULL, channel TEXT NOT NULL,
                    created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sales_receipts (
                    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
                    package_id TEXT NOT NULL, product TEXT NOT NULL,
                    reference TEXT NOT NULL UNIQUE, amount_ils REAL NOT NULL,
                    vat_rate REAL NOT NULL, minutes INTEGER NOT NULL,
                    expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS console_audit (
                    id INTEGER PRIMARY KEY, action TEXT NOT NULL,
                    entity_id TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS console_settings (
                    id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS usage_allocations (
                    call_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
                    product TEXT NOT NULL, receipt_id TEXT,
                    reserved_seconds REAL NOT NULL, billed_seconds REAL,
                    created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS narration_audio (
                    narration_id TEXT PRIMARY KEY, text_hash TEXT NOT NULL,
                    wav BLOB NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS portal_tokens (
                    token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
                    expires_at TEXT NOT NULL);
            """)

    def list(self, kind):
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM console_records WHERE kind=? ORDER BY updated_at DESC", (kind,)
            ).fetchall()
        return [
            {**json.loads(r["body"]), "id": r["id"], "updated_at": r["updated_at"]}
            for r in rows
        ]

    def save_audio(self, narration_id, text_hash, wav):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO narration_audio VALUES (?,?,?,?)",
                       (narration_id, text_hash, wav, now()))

    def get_audio(self, narration_id):
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM narration_audio WHERE narration_id=?", (narration_id,)
            ).fetchone()
        return dict(row) if row else None

    def performance(self, bot_id):
        with self.connect() as db:
            rows = [dict(r) for r in db.execute(
                """SELECT call_id,event_name,since_call_start_ms,details_json FROM latency_events
                WHERE profile_id=? AND created_at>? ORDER BY call_id,since_call_start_ms""",
                (bot_id, (datetime.now(UTC) - timedelta(days=30)).isoformat()),
            )]
        calls = {}
        for r in rows:
            calls.setdefault(r["call_id"], []).append(r)
        connection = []
        greeting = []
        delivery = []
        for events in calls.values():
            markers = {r["event_name"]: r["since_call_start_ms"] for r in events}
            if "gemini_connected" in markers and "gemini_connect_started" in markers:
                connection.append(markers["gemini_connected"] - markers["gemini_connect_started"])
            first = next((r["since_call_start_ms"] for r in events
                          if r["event_name"] == "first_gemini_audio"), None)
            if first is not None and "greeting_sent" in markers:
                greeting.append(first - markers["greeting_sent"])
            ready = {}
            for r in events:
                details = json.loads(r["details_json"])
                turn = details.get("tutor_turn")
                if r["event_name"] == "first_gemini_audio":
                    ready[turn] = r["since_call_start_ms"]
                if r["event_name"] == "first_audio_sent_to_phone" and turn in ready:
                    delivery.append(r["since_call_start_ms"] - ready[turn])

        def stats(values):
            values = sorted(v for v in values if v >= 0)
            if not values:
                return {"samples": 0, "p50": None, "p95": None}
            return {"samples": len(values), "p50": round(values[(len(values)-1)//2]),
                    "p95": round(values[math.ceil(len(values)*.95)-1])}

        return {"days": 30, "connection": stats(connection),
                "first_greeting": stats(greeting), "server_delivery": stats(delivery)}

    def save(self, kind, body, entity_id=None):
        entity_id = entity_id or secrets.token_hex(10)
        if kind == "customers":
            body["phone"] = normalized_phone(body["phone"])
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if kind == "customers":
                db.execute("DELETE FROM customer_phones WHERE customer_id=?", (entity_id,))
                db.execute(
                    "INSERT INTO customer_phones VALUES (?,?)", (body["phone"], entity_id)
                )
            if kind == "courses" and body["active"]:
                if not body["lessons"] or not db.execute(
                    "SELECT 1 FROM bots WHERE id=? AND role='teacher'", (body["bot_id"],)
                ).fetchone():
                    raise ValueError("למסלול פעיל נדרשים מורה ולפחות שיעור אחד")
            if kind == "enrollments":
                for key, target in [("customer_id", "customers"), ("course_id", "courses")]:
                    if not db.execute(
                        "SELECT 1 FROM console_records WHERE kind=? AND id=?",
                        (target, body[key]),
                    ).fetchone():
                        raise ValueError("הלקוח או המסלול לא נמצאו")
                course_row = db.execute(
                    "SELECT body FROM console_records WHERE kind='courses' AND id=?",
                    (body["course_id"],),
                ).fetchone()
                lessons = json.loads(course_row["body"])["lessons"]
                if body["lesson_index"] >= len(lessons):
                    raise ValueError("השיעור שנבחר אינו קיים במסלול")
            db.execute(
                """INSERT INTO console_records VALUES (?,?,?,?,?)
                ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,
                updated_at=excluded.updated_at""",
                (kind, entity_id, json.dumps(body, ensure_ascii=False), now(), now()),
            )
            db.execute(
                "INSERT INTO console_audit(action,entity_id,created_at) VALUES (?,?,?)",
                ("save:" + kind, entity_id, now()),
            )
        return {"id": entity_id, **body}

    def identify_call(self, caller, call_id, bot_id):
        """Keep caller history independent from bot identity, including anonymous calls."""
        try:
            phone = normalized_phone(caller)
        except ValueError:
            phone = None
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT customer_id FROM call_customers WHERE call_id=?", (call_id,)
            ).fetchone()
            if existing:
                if bot_id != "ivr":
                    db.execute(
                        "UPDATE call_customers SET bot_id=? WHERE call_id=?", (bot_id, call_id)
                    )
                return existing["customer_id"]
            row = db.execute(
                "SELECT customer_id FROM customer_phones WHERE phone=?", (phone,)
            ).fetchone() if phone else None
            customer_id = row["customer_id"] if row else (
                "tel-" + hashlib.sha256(phone.encode()).hexdigest()[:24]
                if phone else "anonymous-" + secrets.token_hex(12)
            )
            if phone and not row:
                body = Customer(name="לקוח מהטלפון", phone=phone).model_dump()
                db.execute("INSERT INTO customer_phones VALUES (?,?)", (phone, customer_id))
                db.execute(
                    "INSERT OR IGNORE INTO console_records VALUES ('customers',?,?,?,?)",
                    (customer_id, json.dumps(body, ensure_ascii=False), now(), now()),
                )
            db.execute(
                "INSERT OR IGNORE INTO call_customers VALUES (?,?,?,?,?)",
                (call_id, customer_id, bot_id, "phone", now()),
            )
        return customer_id

    def consume_monthly_quota(self, api, limit):
        month = datetime.now(UTC).strftime("%Y-%m")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT used FROM api_quota WHERE month=? AND api=?", (month, api)
            ).fetchone()
            used = row["used"] if row else 0
            if used >= limit:
                return False
            db.execute(
                """INSERT INTO api_quota VALUES (?,?,1) ON CONFLICT(month,api)
                DO UPDATE SET used=used+1""",
                (month, api),
            )
            return True

    def reserve_call(self, customer_id, bot_id, call_id, max_seconds):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            policy_row = db.execute(
                "SELECT body FROM console_records WHERE kind='policies' AND id=?", (bot_id,)
            ).fetchone()
            policy = AccessPolicy.model_validate_json(policy_row["body"]) if policy_row else (
                AccessPolicy()
            )
            if not policy.enabled:
                return {"seconds": max_seconds, "mode": "unrestricted"}
            receipts = db.execute(
                """SELECT r.*,COALESCE(SUM(COALESCE(u.billed_seconds,
                    u.reserved_seconds)),0) AS spent
                FROM sales_receipts r LEFT JOIN usage_allocations u ON u.receipt_id=r.id
                WHERE r.customer_id=? AND r.product=? AND r.expires_at>?
                GROUP BY r.id ORDER BY r.expires_at""",
                (customer_id, policy.product, now()),
            ).fetchall()
            for receipt in receipts:
                remaining = receipt["minutes"] * 60 - receipt["spent"]
                if remaining >= 1:
                    seconds = min(max_seconds, remaining)
                    db.execute(
                        "INSERT INTO usage_allocations VALUES (?,?,?,?,?,NULL,?)",
                        (call_id, customer_id, policy.product, receipt["id"], seconds, now()),
                    )
                    return {"seconds": seconds, "mode": "paid"}
            month = datetime.now(UTC).strftime("%Y-%m")
            count = db.execute(
                """SELECT COUNT(*) FROM usage_allocations WHERE customer_id=?
                AND product=? AND receipt_id IS NULL AND created_at LIKE ?
                AND (billed_seconds IS NULL OR billed_seconds>0)""",
                (customer_id, policy.product, month + "%"),
            ).fetchone()[0]
            if not customer_id.startswith("anonymous-") and count < policy.free_calls_month:
                seconds = min(max_seconds, policy.free_call_seconds)
                db.execute(
                    "INSERT INTO usage_allocations VALUES (?,?,?,NULL,?,NULL,?)",
                    (call_id, customer_id, policy.product, seconds, now()),
                )
                return {"seconds": seconds, "mode": "free"}
            if policy.basic_enabled and not customer_id.startswith("anonymous-"):
                product = policy.product + "-basic"
                today = datetime.now(UTC).strftime("%Y-%m-%d")
                calls_today = db.execute(
                    """SELECT COUNT(*) FROM usage_allocations WHERE customer_id=?
                    AND product=? AND created_at LIKE ?""",
                    (customer_id, product, today + "%"),
                ).fetchone()[0]
                used = db.execute(
                    """SELECT COALESCE(SUM(COALESCE(billed_seconds,reserved_seconds)),0)
                    FROM usage_allocations WHERE product=? AND created_at LIKE ?""",
                    (product, month + "%"),
                ).fetchone()[0]
                left = policy.basic_month_seconds - used
                if calls_today < policy.basic_calls_day and left >= 10:
                    seconds = min(max_seconds, policy.basic_call_seconds, left)
                    db.execute(
                        "INSERT INTO usage_allocations VALUES (?,?,?,NULL,?,NULL,?)",
                        (call_id, customer_id, product, seconds, now()),
                    )
                    return {"seconds": seconds, "mode": "basic",
                            "intro": policy.basic_intro_text}
            return {"seconds": 0, "mode": "blocked", "extension": policy.blocked_extension}

    def settle_call(self, call_id, seconds):
        with self.connect() as db:
            db.execute(
                """UPDATE usage_allocations SET billed_seconds=MIN(reserved_seconds,?)
                WHERE call_id=? AND billed_seconds IS NULL""", (max(0, seconds), call_id),
            )

    def link_call_segment(self, parent_call_id, segment_id, bot_id):
        """One PBX call can visit several bots; each segment has its own usage and traces."""
        with self.connect() as db:
            parent = db.execute(
                "SELECT customer_id FROM call_customers WHERE call_id=?", (parent_call_id,)
            ).fetchone()
            if not parent:
                raise ValueError("Call must enter authenticated IVR before streaming")
            db.execute("INSERT INTO call_customers VALUES (?,?,?,?,?)",
                       (segment_id, parent[0], bot_id, "phone", now()))

    def customer_detail(self, customer_id):
        customer = next((c for c in self.list("customers") if c["id"] == customer_id), None)
        if not customer:
            raise ValueError("Customer not found")
        with self.connect() as db:
            receipts = [dict(r) for r in db.execute(
                """SELECT r.*, COALESCE(SUM(COALESCE(u.billed_seconds,
                u.reserved_seconds)),0) AS spent_seconds FROM sales_receipts r
                LEFT JOIN usage_allocations u ON u.receipt_id=r.id
                WHERE r.customer_id=? GROUP BY r.id ORDER BY r.created_at DESC""",
                (customer_id,),
            )]
            calls = [dict(r) for r in db.execute(
                """SELECT c.call_id,c.bot_id,c.channel,c.created_at,
                s.duration_seconds,s.summary_he,s.points FROM call_customers c
                LEFT JOIN sessions s ON c.call_id=s.call_id
                WHERE c.customer_id=? ORDER BY c.created_at DESC LIMIT 50""",
                (customer_id,),
            )]
        return {"customer": customer, "receipts": receipts, "calls": calls}

    def portal_invite(self, customer_id):
        self.customer_detail(customer_id)
        token = secrets.token_urlsafe(32)
        expires = datetime.now(UTC) + timedelta(days=7)
        with self.connect() as db:
            db.execute("DELETE FROM portal_tokens WHERE customer_id=?", (customer_id,))
            db.execute("INSERT INTO portal_tokens VALUES (?,?,?)", (
                hashlib.sha256(token.encode()).hexdigest(), customer_id, expires.isoformat(),
            ))
        return {"token": token, "expires_at": expires.isoformat()}

    def portal_customer(self, token):
        with self.connect() as db:
            row = db.execute(
                "SELECT customer_id FROM portal_tokens WHERE token_hash=? AND expires_at>?",
                (hashlib.sha256(token.encode()).hexdigest(), now()),
            ).fetchone()
        return row["customer_id"] if row else None

    def register_web_call(self, call_id, customer_id, bot_id):
        with self.connect() as db:
            db.execute("INSERT INTO call_customers VALUES (?,?,?,?,?)",
                       (call_id, customer_id, bot_id, "web", now()))

    def lesson_context(self, customer_id, bot_id):
        courses = {c["id"]: c for c in self.list("courses")}
        for item in self.list("enrollments"):
            course = courses.get(item["course_id"])
            if (item["customer_id"] != customer_id or item["status"] != "active"
                    or not course or not course["active"] or course["bot_id"] != bot_id):
                continue
            index = item["lesson_index"]
            if index < len(course["lessons"]):
                lesson = course["lessons"][index]
                return (
                    "\nCurrent enrolled lesson (administrator instructions):\n"
                    + json.dumps(lesson, ensure_ascii=False)
                    + "\nUse demonstration, guided practice, free conversation and a summary."
                )
        return ""

    def economics(self):
        with self.connect() as db:
            row = db.execute("SELECT body FROM console_settings WHERE id='economics'").fetchone()
        return Economics.model_validate_json(row["body"]) if row else Economics()

    def save_economics(self, value):
        with self.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO console_settings VALUES ('economics',?)",
                (value.model_dump_json(),),
            )
        return value.model_dump()

    def receipt(self, value: Receipt):
        settings = self.economics()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            package_row = db.execute(
                "SELECT body FROM console_records WHERE kind='packages' AND id=?",
                (value.package_id,),
            ).fetchone()
            customer = db.execute(
                "SELECT 1 FROM console_records WHERE kind='customers' AND id=?",
                (value.customer_id,),
            ).fetchone()
            if not package_row or not customer:
                raise ValueError("לקוח או חבילה לא נמצאו")
            package = Package.model_validate_json(package_row["body"])
            if not package.active:
                raise ValueError("החבילה אינה פעילה")
            row_id = secrets.token_hex(10)
            expires = datetime.now(UTC) + timedelta(days=package.validity_days)
            db.execute(
                "INSERT INTO sales_receipts VALUES (?,?,?,?,?,?,?,?,?,?)",
                (row_id, value.customer_id, value.package_id, package.product,
                 value.reference, value.amount_ils, settings.vat_rate,
                 package.minutes, expires.isoformat(), now()),
            )
        return {"id": row_id, "expires_at": expires.isoformat()}

    def summary(self):
        settings = self.economics()
        month = datetime.now(UTC).strftime("%Y-%m")
        with self.connect() as db:
            sales = [dict(r) for r in db.execute(
                "SELECT * FROM sales_receipts ORDER BY created_at DESC"
            )]
            usage = [dict(r) for r in db.execute("""
                SELECT s.call_id,s.duration_seconds,s.estimated_cost_usd,s.started_at,
                    c.customer_id,c.bot_id,b.role,u.receipt_id,u.call_id AS metered_call
                FROM sessions s LEFT JOIN call_customers c ON c.call_id=s.call_id
                LEFT JOIN bots b ON b.id=c.bot_id
                LEFT JOIN usage_allocations u ON u.call_id=s.call_id
            """)]
        monthly_sales = [r for r in sales if r["created_at"].startswith(month)]
        net = sum(r["amount_ils"] / (1 + r["vat_rate"]) for r in monthly_sales)
        monthly_usage = [r for r in usage if r["started_at"].startswith(month)]
        ai_cost = sum(r["estimated_cost_usd"] for r in monthly_usage) * settings.usd_ils
        free_cost = 0
        for row in monthly_usage:
            if row["role"] == "translator" and (
                (row["metered_call"] and row["receipt_id"] is None) or not any(
                r["customer_id"] == row["customer_id"] and r["product"] == "translator"
                and r["created_at"] <= row["started_at"] < r["expires_at"] for r in sales
                )
            ):
                free_cost += row["estimated_cost_usd"] * settings.usd_ils
        new_payers = {
            r["customer_id"] for r in monthly_sales
            if not any(
                old["customer_id"] == r["customer_id"]
                and old["created_at"] < month for old in sales
            )
        }
        contribution = (
            settings.forecast_price_ils / (1 + settings.vat_rate)
            - settings.forecast_minutes * settings.forecast_cost_per_minute
            - settings.forecast_payment_fee
        )
        known_profit = net - ai_cost - settings.fixed_monthly_ils - settings.paid_marketing_ils
        products = {}
        for product in ("school", "translator"):
            product_sales = [r for r in monthly_sales if r["product"] == product]
            product_usage = [r for r in monthly_usage if r["customer_id"] and (
                (r["role"] == "translator") == (product == "translator")
            )]
            price = getattr(settings, product + "_price_ils")
            minutes = getattr(settings, product + "_minutes")
            minute_cost = getattr(settings, product + "_minute_cost")
            forecast_contribution = price / (1 + settings.vat_rate) - minutes * minute_cost
            products[product] = {
                "paying_customers": len({r["customer_id"] for r in product_sales}),
                "net_receipts": round(sum(
                    r["amount_ils"] / (1 + r["vat_rate"]) for r in product_sales
                ), 2),
                "minutes": round(sum(r["duration_seconds"] for r in product_usage) / 60, 1),
                "ai_cost": round(sum(
                    r["estimated_cost_usd"] for r in product_usage
                ) * settings.usd_ils, 2),
                "forecast_contribution": round(forecast_contribution, 2),
                "scenarios": [{"customers": n,
                    "contribution": round(n * forecast_contribution, 2)}
                    for n in (100, 500, 1000)],
            }
        return {
            "period": month, "customers": len(self.list("customers")),
            "paying_customers_month": len({r["customer_id"] for r in monthly_sales}),
            "gross_receipts_ils": round(sum(r["amount_ils"] for r in monthly_sales), 2),
            "net_receipts_ils": round(net, 2), "ai_cost_ils": round(ai_cost, 2),
            "free_translator_ad_cost_ils": round(free_cost, 2),
            "known_cash_surplus_ils": round(known_profit, 2),
            "cac_ils": round(
                (settings.paid_marketing_ils + free_cost) / len(new_payers), 2
            ) if new_payers else None,
            "ltv_actual": None,
            "forecast_contribution": round(contribution, 2),
            "forecast_ltv": round(contribution * settings.forecast_lifetime_months, 2)
            if settings.forecast_lifetime_months else None,
            "forecast_break_even": math.ceil(
                (settings.fixed_monthly_ils + settings.paid_marketing_ils) / contribution
            ) if contribution > 0 else None,
            "scenarios": [{
                "customers": count, "contribution": round(count * contribution, 2),
                "surplus": round(count * contribution - settings.fixed_monthly_ils
                                 - settings.paid_marketing_ils, 2),
            } for count in (100, 500, 1000)],
            "receipts": sales[:100],
            "products": products,
            "unattributed_sessions": sum(not r["customer_id"] for r in monthly_usage),
            "notes": [
                "תקבולים כוללים רישום ידני ותשלומי נדרים מאומתים (אסמכתה nedarim:); "
                "אינם דוח חשבונאי.",
                "עלות AI משוערת; יתר ההוצאות מוזנות ידנית. אין כאן דוח רווח חשבונאי.",
                "CAC כולל פרסום מוזן ותרגום חינם; אינו כולל זמן עבודה שלא תומחר.",
                "תחזיות מבוססות על הנחות המנהל, לא על נתוני שימור שנמדדו.",
            ],
        }


def install_business_api(app, require_admin):
    router = APIRouter(prefix="/v1/admin/business")

    def store():
        return app.state.business

    @router.get("/performance/{bot_id}")
    async def performance(bot_id: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await asyncio.to_thread(store().performance, bot_id)

    @router.post("/customers/{customer_id}/invite")
    async def portal_invite(
        customer_id: str, authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        try:
            return await asyncio.to_thread(store().portal_invite, customer_id)
        except ValueError as exc:
            raise HTTPException(404, "Customer not found") from exc

    @router.get("/customers/{customer_id}/detail")
    async def customer_detail(
        customer_id: str, authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        try:
            return await asyncio.to_thread(store().customer_detail, customer_id)
        except ValueError as exc:
            raise HTTPException(404, "Customer not found") from exc

    @router.get("/overview")
    async def overview(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await asyncio.to_thread(store().summary)

    @router.get("/economics")
    async def economics(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return (await asyncio.to_thread(store().economics)).model_dump()

    @router.put("/economics")
    async def save_economics(
        body: Economics, authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        return await asyncio.to_thread(store().save_economics, body)

    @router.post("/receipts", status_code=201)
    async def receipt(body: Receipt, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return await asyncio.to_thread(store().receipt, body)
        except (ValueError, sqlite3.IntegrityError) as exc:
            raise HTTPException(409, "רישום כפול או לקוח/חבילה לא תקינים") from exc

    @router.get("/{kind}")
    async def records(kind: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if kind not in MODELS:
            raise HTTPException(404)
        return {"items": await asyncio.to_thread(store().list, kind)}

    @router.post("/{kind}", status_code=201)
    @router.put("/{kind}/{entity_id}")
    async def save(
        kind: str, body: dict, entity_id: str | None = None,
        authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        if kind not in MODELS:
            raise HTTPException(404)
        try:
            validated = MODELS[kind].model_validate(body)
            return await asyncio.to_thread(
                store().save, kind, validated.model_dump(), entity_id,
            )
        except (ValueError, sqlite3.IntegrityError) as exc:
            raise HTTPException(422, "נתונים לא תקינים או מספר טלפון שכבר רשום") from exc

    app.include_router(router)

