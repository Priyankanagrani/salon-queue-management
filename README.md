# Salon Queue Management System

A real-time, bilingual (English & Gujarati) multi-device queue management web application for salons, built with **React**, **Vite**, **Tailwind CSS**, and **Supabase** (with an automatic **Local Sandbox Mode** fallback for zero-config local evaluation).

---

## Screens & Routes

| Screen | Route | Primary User | Key Capabilities |
| :--- | :--- | :--- | :--- |
| **Home Overview** | `/` | Public / Customer | Salon open/closed status, live waiting count, chair-aware wait estimate, barbers on duty, direct Join CTA |
| **Join Queue** | `/join` | Online Customer | Name + 10-digit Indian mobile validation, duplicate active phone check, 1–3 service selection, preferred barber or Any Barber |
| **My Queue Status** | `/status/:id` | Online Customer | Personal token card, barber-eligible position, dynamic wait estimate, next-in-line / your-turn alerts, self-cancellation while waiting |
| **Reception Dashboard** | `/reception` | Receptionist | Staff PIN access, live barber stations, atomic Call Next dispatch, Walk-in registration (works even when online queue is closed), 10-min No-Show timer, >60m highlight alerts |
| **Barber Station Console** | `/barber` & `/barber/:name` | Barber | Per-barber station PIN unlock, active customer details, Start Service / Done workflow, elapsed service timer, Go On Break / Mark Available controls |
| **Waiting Area TV Display** | `/display` | Lounge TV | High-visibility token display (`T-XXX`) & chair status, Next 5 Waiting Tokens, optional Web Audio chime, zero customer PII exposed |
| **Owner Settings** | `/admin` | Salon Owner | Admin PIN gate, IST daily statistics (total, completed, revenue, avg wait), service catalog CRUD (EN/GU), barber duty/break & PIN provisioning, manual online queue toggle & hours |

---

## Architecture & Synchronization

- **Live Supabase Mode** (when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured):
  - All mutations and staff queries execute through hardened `SECURITY DEFINER` PostgreSQL RPC functions (`join_queue`, `get_my_queue_status`, `get_home_queue_stats`, `call_next_customer`, `add_walkin_customer`, `barber_start_service`, `barber_complete_service`, `get_tv_display_data`, `admin_*` RPCs).
  - Row-Level Security (RLS) restricts raw public table writes and protects phone numbers and PIN hashes.
  - Database triggers call `notify_salon_event()` to emit empty-payload broadcasts over Supabase Realtime (`salon-public-updates`), keeping Customer, Reception, Barber, TV, and Owner screens synchronized without leaking table payloads.
- **Local Sandbox Mode** (default when `.env` is absent or left with placeholders):
  - Automatically stores state in `localStorage` and broadcasts updates via custom window/storage events across tabs on the same browser.
  - Mirrors database queue validation, atomic dispatch safeguards, session tokens, and statistics calculations so every screen can be tested locally before provisioning Supabase.

---

## Setup & Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Locally (Local Sandbox Mode)

Start the development server immediately without any `.env` configuration:

```bash
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`).

> **Windows PowerShell note:** If PowerShell script execution policy blocks `npm`, run commands with `npm.cmd` (for example, `npm.cmd run dev` and `npm.cmd run build`).

#### Default Local Sandbox PINs (Local Testing Only)
- **Reception Dashboard (`/reception`):** `1234`
- **Owner Settings (`/admin`):** `9999`
- **Barber Stations (`/barber/:name`):** Amit `1111`, Rahul `2222`, Priya `3333`

In Live Supabase Mode, staff and barber PINs are stored exclusively as salted `pgcrypto` bcrypt hashes in the database and never live in client code.

---

### 3. Configure Live Supabase (Optional Multi-Device Mode)

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Set your project URL and **anon public key** in `.env`:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key-here
   ```
   **Important:** Never place the Supabase `service_role` key in `.env` or any frontend file.
3. Run the SQL setup in the **Supabase SQL Editor**:
   - **Fresh database setup:** Run [`supabase/schema.sql`](supabase/schema.sql) once. It includes the full canonical schema through Stage 7.
   - **Existing Stage 1–3 database upgrade:** Run the additive migrations in exact order:
     1. [`supabase/stage4_reception_rpcs.sql`](supabase/stage4_reception_rpcs.sql)
     2. [`supabase/stage5_barber_tv_rpcs.sql`](supabase/stage5_barber_tv_rpcs.sql)
     3. [`supabase/stage6_admin_rpcs.sql`](supabase/stage6_admin_rpcs.sql)
     4. [`supabase/stage7_final_polish.sql`](supabase/stage7_final_polish.sql)
4. Configure production staff & barber PINs securely in the database (`salon_security` for `reception` / `admin`, and Owner Settings -> **Set / Change PIN** for each barber station).

---

## Production Build

```bash
npm run build
```

Preview the compiled `dist/` bundle locally:

```bash
npm run preview
```

---

## Core Queue Rules Implemented

- **First-Come, First-Served (FCFS):** Strict ordering by `(created_at, id)` across customer position calculation, Reception dispatch, Barber Next preview, and TV queue display.
- **Barber Preference Eligibility:** Customers choosing **Any Available Barber** can be served by the first free barber; customers choosing a specific barber wait only for that barber without blocking other barbers.
- **Duplicate Phone Guard:** Active queue entries (`waiting`, `called`, `in_chair`) reject duplicate 10-digit Indian mobile numbers across both online and walk-in registration.
- **Service Limits & Integrity:** 1–3 active services per entry; total duration and total price are computed server-side from the `services` catalog. At least one active service is always protected against deactivation or concurrent removal.
- **Operating Hours & Auto-Close (`Asia/Kolkata`):** Online joining closes automatically `auto_close_buffer_minutes` (default `30`, supporting `0` minutes) before `closing_time` in IST, as well as before `opening_time`. Walk-in entry at Reception remains available when online joining is closed.
- **No-Show & Status Safeguards:** Customers in `waiting` can self-cancel; once `called` or `in_chair`, self-cancellation is blocked. Reception may mark `no_show` only after the 10-minute arrival window expires. Off-duty toggles on a currently serving barber take effect cleanly after the active customer finishes.
- **Bilingual Support:** Runtime toggle between **English (`EN`)** and **Gujarati (`ગુજરાતી`)** across labels, service names, status badges, and validation messages.
