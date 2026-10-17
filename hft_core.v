module hft_core #(
    parameter DATA_WIDTH   = 32,
    parameter THRESHOLD    = 10,
    parameter WINDOW       = 4,
    parameter CONFIRM      = 1,
    parameter MIN_PROFIT   = 10,
    parameter TAKE_PROFIT  = 25,
    parameter STOP_LOSS    = 20,
    parameter COOLDOWN     = 20
) (
    input  wire                  clk,
    input  wire                  rst,
    input  wire                  tick_valid,
    input  wire [DATA_WIDTH-1:0] price,
    input  wire [DATA_WIDTH-1:0] trade_qty,

    output wire                  order_valid,
    output wire [1:0]            order_side,
    output wire [DATA_WIDTH-1:0] order_qty,
    output wire [DATA_WIDTH-1:0] position,
    output wire                  risk_reject
);

    // Internal connections between modules
    wire [DATA_WIDTH-1:0] average;
    wire                  average_valid;

    wire [1:0]            signal;
    wire                  signal_valid;
    wire [DATA_WIDTH-1:0] signal_price;

    // Module 1: Rolling average (unchanged)
    rolling_average #(
        .DATA_WIDTH(DATA_WIDTH),
        .WINDOW(WINDOW)
    ) P1 (
        .clk(clk),
        .rst(rst),
        .tick_valid(tick_valid),
        .price(price),
        .average(average),
        .average_valid(average_valid)
    );

    // Module 2: Market signal generator
    market_signal #(
        .DATA_WIDTH(DATA_WIDTH),
        .THRESHOLD(THRESHOLD),
        .CONFIRM(CONFIRM)
    ) P2 (
        .clk(clk),
        .rst(rst),
        .tick_valid(tick_valid),
        .price(price),
        .average(average),
        .average_valid(average_valid),
        .signal(signal),
        .signal_valid(signal_valid),
        .signal_price(signal_price)
    );

    // Module 3: Risk manager
    risk_manager #(
        .DATA_WIDTH(DATA_WIDTH),
        .MIN_PROFIT(MIN_PROFIT),
        .TAKE_PROFIT(TAKE_PROFIT),
        .STOP_LOSS(STOP_LOSS),
        .COOLDOWN(COOLDOWN)
    ) P3 (
        .clk(clk),
        .rst(rst),
        .signal(signal),
        .signal_valid(signal_valid),
        .signal_price(signal_price),
        .trade_qty(trade_qty),
        .order_valid(order_valid),
        .order_side(order_side),
        .order_qty(order_qty),
        .position(position),
        .risk_reject(risk_reject)
    );

endmodule