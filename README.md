# HFT-FPGA
Overview
An FPGA-based high-frequency trading demonstrator integrating market-data processing, moving-average signals, risk management, and order validation. The project combines Verilog RTL modules with a software-side interface for market simulation and visualization.
Key Features
- Market tick processing from historical CSV data.
- Rolling-average calculation and BUY/SELL/HOLD signals.
- Risk management and position-limit enforcement.
- Integrated HFT core verified through simulation.
- FPGA board interface with UART output.
- Web dashboard for visualizing simulated trading activity, if implemented in the current build.
Architecture
Historical Market Data (CSV)
Market Data Processing
Rolling Average → Trading Signals
Risk Manager → Order Validation
FPGA Output / UART / Dashboard

Verification
- Rolling-average module: simulation passed.
- Market-signal module: simulation passed.
- Risk-manager module: tests passed.
- HFT-core integration: simulation passed.
Screenshot
Add a screenshot of the actual running web dashboard here:
docs/dashboard.png
<img width="1917" height="1078" alt="image" src="https://github.com/user-attachments/assets/fe14e5ec-a751-41fd-9732-366669cf849b" />



Project Status
An educational FPGA trading demonstrator. It is not a production trading system and does not guarantee profits.
