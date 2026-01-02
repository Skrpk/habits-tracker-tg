import * as fs from 'fs';
import * as path from 'path';

const quotesTxtPath = path.join(__dirname, 'quotes.txt');
const quotesJsonPath = path.join(__dirname, 'quotes-2.json');

// Read quotes.txt and extract lines 1-87
const quotesTxtContent = fs.readFileSync(quotesTxtPath, 'utf-8');
const quotesLines = quotesTxtContent.split('\n').slice(0, 87).map(line => line.trim()).filter(line => line.length > 0);

// Read existing quotes-2.json
const quotesJsonContent = fs.readFileSync(quotesJsonPath, 'utf-8');
const quotesData = JSON.parse(quotesJsonContent);

// Add new quotes with author "Marcus Tullius Cicero"
const newQuotes = quotesLines.map(text => ({
  text: text,
  author: "Tacitus"
}));

// Append to existing quotes array
quotesData.quotes.push(...newQuotes);

// Write back to quotes-2.json with proper formatting
fs.writeFileSync(quotesJsonPath, JSON.stringify(quotesData, null, 2), 'utf-8');

console.log(`Added ${newQuotes.length} quotes from quotes.txt to quotes-2.json`);
console.log(`Total quotes in quotes-2.json: ${quotesData.quotes.length}`);

