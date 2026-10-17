// risk_manager.v  (position, entry price, take-profit, stop-loss, cooldown)
//
// Rules, evaluated every time a signal_valid pulse arrives:
//   1. STOP LOSS   : long and price <= entry_price - STOP_LOSS      -> sell all, start COOLDOWN
//   2. TAKE PROFIT : long and price >= entry_price + TAKE_PROFIT    -> sell all
//   3. EXIT        : long, signal==SELL and price >= entry_price + MIN_PROFIT -> sell all
//                    (a SELL signal alone never sells at a loss)
//   4. ENTRY       : flat, signal==BUY, cooldown over, qty within limits -> buy trade_qty
//                    (no stacking: while long, further BUY signals are ignored)
//
// Because entries only happen when flat, the average entry price is just
// entry_price, so no multiplication or division is needed.
//
// All price-like parameters are per share, in the same units as price (paise).
// MIN_PROFIT / TAKE_PROFIT should be larger than spread + fees, or a "win"
// is still a net loss.
module risk_manager #(
    parameter DATA_WIDTH     = 32,
    parameter MAX_POSITION   = 100,
    parameter MAX_ORDER_QTY  = 10,
    parameter MIN_PROFIT     = 10,
    parameter TAKE_PROFIT    = 25,
    parameter STOP_LOSS      = 20,
    parameter COOLDOWN       = 20
) (
    input  wire                  clk,
    input  wire                  rst,
    input  wire                  signal_valid,
    input  wire [1:0]            signal,
    input  wire [DATA_WIDTH-1:0] signal_price,
    input  wire [DATA_WIDTH-1:0] trade_qty,

    output reg                   order_valid,
    output reg  [1:0]            order_side,
    output reg  [DATA_WIDTH-1:0] order_qty,
    output reg  [DATA_WIDTH-1:0] position,
    output reg                   risk_reject
);

    localparam HOLD = 2'b00;
    localparam BUY  = 2'b01;
    localparam SELL = 2'b10;

    reg [DATA_WIDTH-1:0] entry_price;
    reg [15:0]           cooldown_cnt;

    wire have_pos = (position != 0);

    // Extra bit prevents overflow in the BUY limit check and price comparisons.
    wire [DATA_WIDTH:0] buy_total = {1'b0, position} + {1'b0, trade_qty};

    wire [DATA_WIDTH:0] price_ext     = {1'b0, signal_price};
    wire [DATA_WIDTH:0] entry_ext     = {1'b0, entry_price};
    wire [DATA_WIDTH:0] tp_level      = entry_ext + TAKE_PROFIT;
    wire [DATA_WIDTH:0] min_exit_lvl  = entry_ext + MIN_PROFIT;
    wire [DATA_WIDTH:0] price_plus_sl = price_ext + STOP_LOSS;

    wire hit_stop = have_pos && (entry_ext >= price_plus_sl);
    wire hit_tp   = have_pos && (price_ext >= tp_level);
    wire hit_exit = have_pos && (signal == SELL) && (price_ext >= min_exit_lvl);

    always @(posedge clk) begin
        if (rst) begin
            position     <= 0;
            entry_price  <= 0;
            cooldown_cnt <= 0;
            order_valid  <= 0;
            risk_reject  <= 0;
            order_side   <= HOLD;
            order_qty    <= 0;
        end else begin
            order_valid <= 0;
            risk_reject <= 0;

            if (signal_valid) begin
                if (cooldown_cnt != 0)
                    cooldown_cnt <= cooldown_cnt - 1'b1;

                if (hit_stop) begin
                    order_valid  <= 1;
                    order_side   <= SELL;
                    order_qty    <= position;
                    position     <= 0;
                    cooldown_cnt <= COOLDOWN;      // overrides the decrement above
                end
                else if (hit_tp || hit_exit) begin
                    order_valid <= 1;
                    order_side  <= SELL;
                    order_qty   <= position;
                    position    <= 0;
                end
                else if (signal == BUY && !have_pos) begin
                    if ((trade_qty == 0) || (trade_qty > MAX_ORDER_QTY)) begin
                        risk_reject <= 1;
                    end
                    else if (cooldown_cnt != 0) begin
                        // Still cooling down after a stop-loss: skip silently.
                        order_side <= HOLD;
                        order_qty  <= 0;
                    end
                    else if (buy_total <= MAX_POSITION) begin
                        order_valid <= 1;
                        order_side  <= BUY;
                        order_qty   <= trade_qty;
                        position    <= trade_qty;
                        entry_price <= signal_price;
                    end
                    else begin
                        risk_reject <= 1;
                    end
                end
                else if (signal == 2'b11) begin
                    // Invalid signal encoding.
                    risk_reject <= 1;
                end
                else begin
                    // HOLD, SELL below the profit bar, or BUY while already long.
                    order_side <= HOLD;
                    order_qty  <= 0;
                end
            end
        end
    end

endmodule