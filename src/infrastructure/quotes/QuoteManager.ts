import * as fs from 'fs';
import * as path from 'path';

interface Quote {
  text: string;
  author: string;
}

interface QuotesData {
  quotes: Quote[];
}

const QUOTES_FILE_PATH = path.join(process.cwd(), 'quotes', 'quotes-2.json');

export class QuoteManager {
  private quotes: Quote[] = [];
  private quotesData: QuotesData | null = null;

  private async loadQuotes(): Promise<void> {
    try {
      const fileContent = fs.readFileSync(QUOTES_FILE_PATH, 'utf-8');
      this.quotesData = JSON.parse(fileContent) as QuotesData;
      this.quotes = this.quotesData.quotes || [];
    } catch (error) {
      throw new Error(`Failed to load quotes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async saveQuotes(): Promise<void> {
    try {
      if (!this.quotesData) {
        throw new Error('Quotes data not loaded');
      }
      this.quotesData.quotes = this.quotes;
      console.log('WWWWW', QUOTES_FILE_PATH);
      fs.writeFileSync(QUOTES_FILE_PATH, JSON.stringify(this.quotesData, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save quotes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getQuote(index: number): Promise<Quote | null> {
    await this.loadQuotes();
    if (index < 0 || index >= this.quotes.length) {
      return null;
    }
    return this.quotes[index];
  }

  async deleteQuote(index: number): Promise<boolean> {
    await this.loadQuotes();
    if (index < 0 || index >= this.quotes.length) {
      return false;
    }
    this.quotes.splice(index, 1);
    await this.saveQuotes();
    return true;
  }

  async editQuote(index: number, newText: string, newAuthor?: string): Promise<boolean> {
    await this.loadQuotes();
    if (index < 0 || index >= this.quotes.length) {
      return false;
    }
    this.quotes[index].text = newText;
    if (newAuthor) {
      this.quotes[index].author = newAuthor;
    }
    await this.saveQuotes();
    return true;
  }

  async getTotalQuotes(): Promise<number> {
    await this.loadQuotes();
    return this.quotes.length;
  }
}

