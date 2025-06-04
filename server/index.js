// index.js (Smart Resume Analyzer + Geo + Experience + Real URLs + CV Strength + Improvement)

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

function queryOllama(prompt) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const process = spawn('curl', [
      '-s', '-X', 'POST', 'http://localhost:11434/api/generate',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ model: 'mistral', prompt, stream: false })
    ]);

    process.stdout.on('data', chunk => chunks.push(chunk));
    process.stderr.on('data', err => reject(err.toString()));
    process.on('close', () => {
      try {
        const output = Buffer.concat(chunks).toString();
        const parsed = JSON.parse(output);
        resolve(parsed.response);
      } catch (err) {
        reject('Error parsing Ollama response');
      }
    });
  });
}

function suggestCourses(skills) {
  return skills.map(skill => ({
    skill,
    coursera: `https://www.coursera.org/search?query=${encodeURIComponent(skill)}`,
    udemy: `https://www.udemy.com/courses/search/?q=${encodeURIComponent(skill)}`
  }));
}

app.post('/api/upload', upload.single('resume'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const ext = path.extname(filePath).toLowerCase();
    let extractedText = '';

    if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      extractedText = pdfData.text;
    } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      const result = await Tesseract.recognize(filePath, 'eng');
      extractedText = result.data.text;
    } else {
      return res.status(400).json({ error: 'Only PDF or image files allowed.' });
    }

    const basePrompt = `Analyze the resume below and extract:
- experience_level (Junior, Mid, Senior or Fresh Graduate)
- country (from address, phone, or other hints)
- skills (up to 5)
- suggested_job_titles (3 matching titles)

Return this format:
{
  "experience_level": "",
  "country": "",
  "skills": [],
  "suggested_job_titles": []
}
Resume:\n${extractedText}`;

    const analysis = await queryOllama(basePrompt);
    const parsed = JSON.parse(analysis);

    const { experience_level, country, skills, suggested_job_titles } = parsed;
    const courseRecommendations = suggestCourses(skills);

    const jobPrompt = `You are a smart job recommender. Based on:
Country: ${country || 'global'}
Experience: ${experience_level || 'Junior'}
Skills: ${skills.join(', ')}
Job Titles: ${suggested_job_titles.join(', ')}

Generate 5 realistic job listings (title, company, location, url, description) with working links from Google, LinkedIn, Indeed, Glassdoor or similar. Return JSON array.`;

    let jobResults = [];
    try {
      const jobData = await queryOllama(jobPrompt);
      jobResults = JSON.parse(jobData);
    } catch (err) {
      jobResults = suggested_job_titles.map(title => ({
        title,
        company: 'Example Corp',
        location: country || 'Remote',
        url: `https://www.google.com/search?q=${encodeURIComponent(title + ' ' + country + ' jobs')}`,
        description: `Search for ${title} roles in ${country}`
      }));
    }

    const strengthPrompt = `Based on the resume below, evaluate:
1. CV strength (Strong, Moderate, Weak)
2. 3 improvement suggestions

Resume:\n${extractedText}`;

    const strengthAnalysis = await queryOllama(strengthPrompt);
    const strengthMatch = strengthAnalysis.match(/(Strong|Moderate|Weak)/i);
    const cv_strength = strengthMatch ? strengthMatch[0] : 'Unknown';
    const improvementSuggestions = strengthAnalysis.split(/\n|\*/).filter(line =>
      line.toLowerCase().includes('suggestion') || line.trim().startsWith('-')
    ).slice(0, 3);

    res.json({
      message: 'Resume analyzed successfully (Geo + AI Jobs)',
      experience_level,
      country,
      skills,
      suggested_job_titles,
      course_recommendations: courseRecommendations,
      job_results: jobResults,
      cv_strength,
      improvement_suggestions: improvementSuggestions
    });

  } catch (err) {
    console.error('❌ Server Error:', err);
    res.status(500).json({ error: 'Failed to process resume.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Smart Resume Server running on port ${PORT}`));
