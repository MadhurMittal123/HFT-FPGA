import csv
import json
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORTS = ROOT / "reports"

HOST = "127.0.0.1"
PORT = 8000
SERIAL_PORT = "COM3"
BAUD_RATE = 115200
MAX_RECORDS = 1000
SEND_DELAY_S = 0   # pause between prices (UART round trip is only a few ms)
LOOP_REPLAY =  True   # True = restart the CSV at the end (price jumps back, positions persist)

ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}

live_records = deque(maxlen=MAX_RECORDS)
live_lock = threading.Lock()
serial_lock = threading.Lock()

serial_thread_started = False
serial_connected = False
serial_error = ""


def read_csv(filename):
    path = REPORTS / filename

    if not path.exists():
        raise FileNotFoundError(f"Missing data file: {path}")

    with path.open("r", newline="", encoding="utf-8-sig") as file:
        return list(csv.DictReader(file))


def number(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0


def serial_worker():
    global serial_connected, serial_error

    csv_path = ROOT / "data" / "reliance_fpga.csv"

    while True:
        try:
            import serial

            # Load prices from the RELIANCE CSV.
            with csv_path.open(
                "r",
                newline="",
                encoding="utf-8-sig",
            ) as file:
                replay_rows = [
                    row for row in csv.DictReader(file)
                    if number(row.get("last_paise")) > 0
                ]

            if not replay_rows:
                raise ValueError(
                    f"No valid last_paise values found in {csv_path}"
                )

            with serial.Serial(
                SERIAL_PORT,
                BAUD_RATE,
                timeout=1,
                write_timeout=2,
            ) as port:

                with serial_lock:
                    serial_connected = True
                    serial_error = ""

                print(f"[UART] Connected to {SERIAL_PORT} at {BAUD_RATE} baud")
                print(f"[REPLAY] Loaded {len(replay_rows)} RELIANCE prices")

                # Replay the CSV continuously through the FPGA.
                while True:
                    for row in replay_rows:
                        input_price = number(row.get("last_paise"))

                        # FPGA input expects ASCII decimal followed by newline.
                        # Drop any late packet from the previous tick so it can
                        # never be attributed to this one.
                        port.reset_input_buffer()
                        port.write(f"{input_price}\r\n".encode("ascii"))
                        port.flush()

                        # Wait up to approximately 3 seconds for the FPGA packet.
                        deadline = time.monotonic() + 3
                        packet_received = False

                        while time.monotonic() < deadline:
                            first = port.read(1)

                            if first != b"H":
                                continue

                            second = port.read(1)

                            if second != b"F":
                                continue

                            payload = port.read(12)

                            if len(payload) != 12:
                                continue

                            price = int.from_bytes(payload[0:4], "big")
                            flags = payload[4]
                            side = payload[5] & 0x03
                            quantity = int.from_bytes(
                                payload[6:10], "big"
                            )
                            position = int.from_bytes(
                                payload[10:12], "big"
                            )

                            with live_lock:
                                cycle = (
                                    live_records[-1]["cycle"] + 1
                                    if live_records else 1
                                )

                                live_records.append({
                                    "cycle": cycle,
                                    "price": price,
                                    "orderValid": bool(flags & 0x01),
                                    "riskReject": bool(flags & 0x02),
                                    "side": side,
                                    "quantity": quantity,
                                    "position": position,
                                })

                            packet_received = True
                            print(
                                f"[FPGA] Cycle={cycle} "
                                f"Price={price} "
                                f"OrderValid={bool(flags & 0x01)} "
                                f"RiskReject={bool(flags & 0x02)} "
                                f"Position={position}"
                            )
                            break

                        if not packet_received:
                            print(
                                f"[UART] No FPGA response for price "
                                f"{input_price}"
                            )

                        time.sleep(SEND_DELAY_S)

                    if not LOOP_REPLAY:
                        print("[REPLAY] Finished one pass over the CSV. "
                              "Set LOOP_REPLAY = True to repeat.")
                        while True:
                            time.sleep(60)

        except Exception as error:
            with serial_lock:
                serial_connected = False
                serial_error = str(error)

            print(f"[UART] {error}; retrying in 2 seconds")
            time.sleep(2)


def start_serial_reader():
    global serial_thread_started

    with serial_lock:
        if serial_thread_started:
            return

        serial_thread_started = True

        threading.Thread(
            target=serial_worker,
            daemon=True,
            name="FPGA-UART-reader",
        ).start()


class Handler(BaseHTTPRequestHandler):

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        origin = self.headers.get("Origin", "")

        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8",
        )

        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")

        if origin not in ALLOWED_ORIGINS:
            self.send_json({
                "status": "error",
                "message": "Origin not allowed",
            }, 403)
            return

        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header(
            "Access-Control-Allow-Methods",
            "GET, OPTIONS",
        )
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type",
        )
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/")

        # --------------------------------------------------
        # API STATUS
        # --------------------------------------------------
        if path == "/api/status":
            with serial_lock:
                connected = serial_connected
                error = serial_error

            self.send_json({
                "status": "ok",
                "historicalAvailable": True,
                "liveConnected": connected,
                "liveError": error,
            })
            return

        # --------------------------------------------------
        # LIVE FPGA UART DATA
        # --------------------------------------------------
        if path == "/api/live":
            start_serial_reader()

            with serial_lock:
                connected = serial_connected
                error = serial_error

            with live_lock:
                records = list(live_records)

            ticks = [
                {
                    "cycle": record["cycle"],
                    "pricePaise": record["price"],
                }
                for record in records
            ]

            orders = [
                {
                    "cycle": record["cycle"],
                    "pricePaise": record["price"],
                    "averagePaise": 0,
                    "signal": record["side"],
                    "side": record["side"],
                    "quantity": record["quantity"],
                    "position": record["position"],
                }
                for record in records
                if record["orderValid"]
            ]

            risks = [
                {
                    "cycle": record["cycle"],
                    "pricePaise": record["price"],
                    "signal": 0,
                    "position": record["position"],
                }
                for record in records
                if record["riskReject"]
            ]

            self.send_json({
                "status": "ok",
                "source": (
                    "FPGA UART"
                    if connected
                    else "Waiting for FPGA UART"
                ),
                "mode": "LIVE FPGA",
                "symbol": "RELIANCE",
                "connected": connected,
                "serialError": error,
                "ticks": ticks,
                "orders": orders,
                "risks": risks,
                "cycleCount": len(records),
                "tickCount": len(ticks),
                "orderCount": len(orders),
                "riskCount": len(risks),
            })
            return

        # --------------------------------------------------
        # HISTORICAL VERILOG SIMULATION REPLAY
        # --------------------------------------------------
        if path == "/api/data":
            try:
                trace = read_csv("rtl_full_replay_trace.csv")
                ticks = read_csv("rtl_market_ticks.csv")
                orders = read_csv("rtl_order_events.csv")
                risks = read_csv("rtl_risk_events.csv")

                self.send_json({
                    "status": "ok",
                    "source": "VERILOG SIMULATION",
                    "mode": "HISTORICAL REPLAY",
                    "symbol": "RELIANCE",

                    "ticks": [
                        {
                            "cycle": number(record.get("cycle")),
                            "pricePaise": number(
                                record.get("price_paise")
                            ),
                        }
                        for record in ticks
                    ],

                    "orders": [
                        {
                            "cycle": number(record.get("cycle")),
                            "pricePaise": number(
                                record.get("price_paise")
                            ),
                            "averagePaise": number(
                                record.get("average")
                            ),
                            "signal": number(record.get("signal")),
                            "side": number(record.get("order_side")),
                            "quantity": number(record.get("order_qty")),
                            "position": number(record.get("position")),
                        }
                        for record in orders
                    ],

                    "risks": [
                        {
                            "cycle": number(record.get("cycle")),
                            "pricePaise": number(
                                record.get("price_paise")
                            ),
                            "signal": number(record.get("signal")),
                            "position": number(record.get("position")),
                        }
                        for record in risks
                    ],

                    "cycleCount": len(trace),
                    "tickCount": len(ticks),
                    "orderCount": len(orders),
                    "riskCount": len(risks),
                })

            except Exception as error:
                self.send_json({
                    "status": "error",
                    "message": str(error),
                }, 500)

            return

        # --------------------------------------------------
        # UNKNOWN ROUTE
        # --------------------------------------------------
        self.send_json({
            "status": "error",
            "message": "Not found",
        }, 404)

    def log_message(self, format, *args):
        print(f"[API] {args[0]}")


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)

    print(f"HFT API running at http://{HOST}:{PORT}")
    print(f"Historical replay: http://{HOST}:{PORT}/api/data")
    print(f"Live FPGA:         http://{HOST}:{PORT}/api/live")
    print(f"Status:            http://{HOST}:{PORT}/api/status")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping HFT API...")
    finally:
        server.server_close()