const encoder = new TextEncoder();
const CLEAR_LINE = "\x1b[2K\r";

export class TerminalDisplay {
  private statusText = "";
  private statusVisible = false;
  private readonly tty = Deno.isatty(Deno.stdout.rid);

  info(message: string) {
    this.writeLine(message);
  }

  warn(message: string) {
    this.writeLine(`WARN: ${message}`);
  }

  error(message: string) {
    this.writeLine(`ERROR: ${message}`);
  }

  setStatus(message: string) {
    this.statusText = message;
    this.renderStatus();
  }

  clearStatus() {
    if (!this.statusVisible || !this.tty) return;
    Deno.stdout.writeSync(encoder.encode(CLEAR_LINE));
    this.statusVisible = false;
  }

  close() {
    this.clearStatus();
  }

  private writeLine(message: string) {
    if (this.statusVisible && this.tty) {
      Deno.stdout.writeSync(encoder.encode(CLEAR_LINE));
      this.statusVisible = false;
    }
    console.log(message);
    this.renderStatus();
  }

  private renderStatus() {
    if (!this.statusText) return;
    if (this.tty) {
      Deno.stdout.writeSync(
        encoder.encode(`${CLEAR_LINE}${this.statusText}\n`),
      );
      this.statusVisible = true;
    } else {
      console.log(`[status] ${this.statusText}`);
    }
  }
}
