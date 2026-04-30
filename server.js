// server.js
// Simple Express server that serves the frontend and provides the ABRIL.xlsx data.
// It watches the Excel file for changes and serves fresh data on each request.

const express = require('express');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const chokidar = require('chokidar');

const app = express();
const PORT = 3000;

// Absolute path to the Excel file (Downloads folder)
const EXCEL_PATH = path.resolve('C:/Users/sup.luciana/Downloads/ABRIL.xlsx');

// Serve static files from the project directory
app.use(express.static(path.join(__dirname, '')));

// Endpoint that returns the workbook data as JSON
app.get('/data', (req, res) => {
  try {
    const wb = XLSX.readFile(EXCEL_PATH);
    const result = {};
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      result[name] = XLSX.utils.sheet_to_json(ws, {defval: ''});
    });
    res.json({sheets: result});
  } catch (e) {
    console.error('Error reading Excel file:', e);
    res.status(500).json({error: 'Failed to read Excel file'});
  }
});

// Watch the Excel file for changes – just log to console (client will fetch on its own)
chokidar.watch(EXCEL_PATH).on('change', () => {
  console.log('ABRIL.xlsx changed – new data will be served on next request');
});

app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
