
module hft_uart_reporter #(
    parameter integer CLK_FREQ  = 100_000_000,
    parameter integer BAUD_RATE = 115200
)(
    input  wire        clk,
    input  wire        rst,

    input  wire        tick_valid,
    input  wire [31:0] price,
    input  wire        order_valid,
    input  wire [1:0]  order_side,
    input  wire [31:0] order_qty,
    input  wire [31:0] position,
    input  wire        risk_reject,

    output wire        uart_tx_pin
);

    localparam integer RECORD_BYTES = 14;

    localparam [1:0] HOLD = 2'b00;

    reg [7:0] record [0:RECORD_BYTES-1];
    reg [3:0] byte_index;
    reg [7:0] tx_data;
    reg       tx_valid;

    wire tx_busy;
    wire tx_done;

    reg sending;
    reg pending;

    // Three-stage pipeline for tick and price alignment.
    reg        tick_d1, tick_d2, tick_d3;
    reg [31:0] price_d1, price_d2, price_d3;

    // Snapshot of one market tick and its resulting decision.
    reg [31:0] saved_price;
    reg        saved_order_valid;
    reg [1:0]  saved_order_side;
    reg [31:0] saved_order_qty;
    reg [31:0] saved_position;
    reg        saved_risk_reject;

    uart_tx #(
        .CLK_FREQ(CLK_FREQ),
        .BAUD_RATE(BAUD_RATE)
    ) transmitter (
        .clk(clk),
        .rst(rst),
        .data_in(tx_data),
        .data_valid(tx_valid),
        .tx(uart_tx_pin),
        .busy(tx_busy),
        .done(tx_done)
    );

    always @(posedge clk) begin
        if (rst) begin
            tick_d1  <= 0;
            tick_d2  <= 0;
            tick_d3  <= 0;
            price_d1 <= 0;
            price_d2 <= 0;
            price_d3 <= 0;

            byte_index <= 0;
            tx_data    <= 0;
            tx_valid   <= 0;
            sending    <= 0;
            pending    <= 0;

            saved_price       <= 0;
            saved_order_valid <= 0;
            saved_order_side  <= HOLD;
            saved_order_qty   <= 0;
            saved_position    <= 0;
            saved_risk_reject <= 0;
        end else begin
            tx_valid <= 0;

            // Delay the tick marker and its price together.
            tick_d1  <= tick_valid;
            tick_d2  <= tick_d1;
            tick_d3  <= tick_d2;

            price_d1 <= price;
            price_d2 <= price_d1;
            price_d3 <= price_d2;

            // Capture the decision after the core's registered
            // signal and risk-manager stages have updated.
            if (!sending && !pending && tick_d3) begin
                saved_price       <= price_d3;
                saved_order_valid <= order_valid;

                // Do not report stale order fields on HOLD ticks
                // or rejected orders.
                if (order_valid) begin
                    saved_order_side <= order_side;
                    saved_order_qty  <= order_qty;
                end else begin
                    saved_order_side <= HOLD;
                    saved_order_qty  <= 0;
                end

                saved_position    <= position;
                saved_risk_reject <= risk_reject;

                pending <= 1;
            end

            // Build one 14-byte record from the captured snapshot.
            if (pending && !sending) begin
                record[0]  <= 8'h48; // H
                record[1]  <= 8'h46; // F

                record[2]  <= saved_price[31:24];
                record[3]  <= saved_price[23:16];
                record[4]  <= saved_price[15:8];
                record[5]  <= saved_price[7:0];

                // Bit 0 = order_valid
                // Bit 1 = risk_reject
                record[6]  <= {
                    6'b000000,
                    saved_risk_reject,
                    saved_order_valid
                };

                record[7]  <= {6'b000000, saved_order_side};

                record[8]  <= saved_order_qty[31:24];
                record[9]  <= saved_order_qty[23:16];
                record[10] <= saved_order_qty[15:8];
                record[11] <= saved_order_qty[7:0];

                // Position is transmitted as a 16-bit value.
                record[12] <= saved_position[15:8];
                record[13] <= saved_position[7:0];

                byte_index <= 0;
                pending    <= 0;
                sending    <= 1;
            end
            else if (sending && tx_done) begin
                if (byte_index == RECORD_BYTES - 1) begin
                    sending <= 0;
                end else begin
                    byte_index <= byte_index + 1'b1;
                end
            end
            else if (sending && !tx_busy && !tx_valid) begin
                tx_data  <= record[byte_index];
                tx_valid <= 1;
            end
        end
    end

endmodule
