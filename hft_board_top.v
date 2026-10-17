
module hft_board_top (
    input  wire       clk,
    input  wire [3:0] btn,
    input  wire       uart_rx_pin,
    output reg  [3:0] led,
    output wire       uart_tx_pin
);

    // Active-high reset from button 0.
    wire rst = btn[0];

    // Price received from the PC through UART.
    (* MARK_DEBUG = "TRUE" *)
    wire [31:0] price;

    (* MARK_DEBUG = "TRUE" *)
    wire tick_valid;

    wire line_error;

    // Parse decimal ASCII price lines from the PC.
    // Example input: 118950 followed by newline.
    uart_price_frontend #(
        .DATA_WIDTH(32),
        .MAX_DIGITS(10)
    ) price_receiver (
        .clk(clk),
        .rst(rst),
        .uart_rx_pin(uart_rx_pin),
        .price(price),
        .price_valid(tick_valid),
        .line_error(line_error)
    );

    wire [31:0] trade_qty = 32'd10;

    (* MARK_DEBUG = "TRUE" *)
    wire order_valid;

    (* MARK_DEBUG = "TRUE" *)
    wire [1:0] order_side;

    (* MARK_DEBUG = "TRUE" *)
    wire [31:0] order_qty;

    (* MARK_DEBUG = "TRUE" *)
    wire [31:0] position;

    (* MARK_DEBUG = "TRUE" *)
    wire risk_reject;

    // Existing HFT core - trading logic unchanged.
    hft_core #(
        .DATA_WIDTH(32),
        .THRESHOLD(5),
        .WINDOW(4)
    ) core (
        .clk(clk),
        .rst(rst),
        .tick_valid(tick_valid),
        .price(price),
        .trade_qty(trade_qty),
        .order_valid(order_valid),
        .order_side(order_side),
        .order_qty(order_qty),
        .position(position),
        .risk_reject(risk_reject)
    );

    // Send HFT records from the FPGA to the PC.
    hft_uart_reporter #(
        .CLK_FREQ(100_000_000),
        .BAUD_RATE(115200)
    ) uart_reporter (
        .clk(clk),
        .rst(rst),
        .tick_valid(tick_valid),
        .price(price),
        .order_valid(order_valid),
        .order_side(order_side),
        .order_qty(order_qty),
        .position(position),
        .risk_reject(risk_reject),
        .uart_tx_pin(uart_tx_pin)
    );

    // LEDs:
    // LED 0 = most recent BUY
    // LED 1 = most recent SELL
    // LED 2 = risk rejection observed
    // LED 3 = received market-price tick indicator
    always @(posedge clk) begin
        if (rst) begin
            led <= 4'b0000;
        end else begin
            if (tick_valid)
                led[3] <= ~led[3];

            if (order_valid) begin
                if (order_side == 2'b01) begin
                    led[0] <= 1'b1;
                    led[1] <= 1'b0;
                end else if (order_side == 2'b10) begin
                    led[0] <= 1'b0;
                    led[1] <= 1'b1;
                end
            end

            if (risk_reject)
                led[2] <= 1'b1;
        end
    end

endmodule
