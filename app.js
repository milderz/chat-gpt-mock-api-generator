require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');

const app = express();
app.set('trust proxy', true);
app.use(bodyParser.json());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 500 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use('/generate-mock-api', limiter);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Helper function to parse OpenAI response
function parseOpenAIResponse(apiSpec) {
  try {
    // Handle markdown code blocks
    const jsonMatch = apiSpec.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1]);
    }
    
    // Handle text before/after JSON
    const firstBrace = apiSpec.indexOf('{');
    const lastBrace = apiSpec.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      const jsonString = apiSpec.slice(firstBrace, lastBrace + 1);
      return JSON.parse(jsonString);
    }
    
    // Try direct parse
    return JSON.parse(apiSpec);
  } catch (e) {
    // Final attempt with sanitization
    try {
      const sanitized = apiSpec
        .replace(/^[^{]*/, '')
        .replace(/[^}]*$/, '')
        .replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2":')
        .replace(/'/g, '"');
      return JSON.parse(sanitized);
    } catch (finalError) {
      console.error('Final parsing failed:', apiSpec);
      throw new Error(`Failed to parse API specification: ${finalError.message}`);
    }
  }
}

// Endpoint to generate mock API
app.post('/generate-mock-api', async (req, res) => {
  try {
    const { description } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const prompt = `
      Based on the following description, create a comprehensive mock API specification in JSON format.
      This value should aways be named results:  "results":, ALWAYS provide a minimun of 5 results.

      Each result should include as minimum the following fields:
      - id: Unique identifier for the item
      - name: Name of the item
      - description: Description of the item
      - category: Category of the item
      - price: Price of the item
      
    
    
      
      Description: ${description}
      
      Format should follow this example structure:
      {
        "totalResults": 5,
        "id": 1,
        "templateName": "Product List",
        "templateDescription": "A list of products with details.",
        "totalPages": 1,
        "currentPage": 1,
        "resultsPerPage": 5,
        "results": [
          {
            "id": 1,
            "name": "Product Name",
            "description": "Product description",
            "category": "Product category",
            "price": 0.00,
            "stock": 0,
            "rating": 0.0
          },
          {
            "id": 2,
            "name": "Product Name",
            "description": "Product description",
            "category": "Product category",
            "price": 0.00,
            "stock": 0,
            "rating": 0.0
          }
        ]
      }
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are an API design assistant. Return ONLY raw JSON without any commentary or markdown formatting." 
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    }).catch(error => {
      if (error.status === 429) {
        throw new Error("OpenAI API rate limit exceeded. Please try again later.");
      }
      throw error;
    });

    const apiSpec = completion.choices[0]?.message?.content;
    
    try {
      const parsedSpec = parseOpenAIResponse(apiSpec);
      res.json(parsedSpec);
    } catch (e) {
      res.status(500).json({ 
        error: e.message,
        rawResponse: apiSpec,
        suggestion: "The API specification might need manual adjustment"
      });
    }

  } catch (error) {
    console.error('Error:', error);
    if (error.message.includes('rate limit')) {
      res.status(429).json({ 
        error: "Rate limit exceeded",
        message: error.message 
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to generate mock API',
        details: error.message 
      });
    }
  }
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Test function
// async function testApiGeneration() {
//   try {
//     const description = "I need a REST API for a blog platform with posts, comments, and user profiles";
//     console.log("\nTesting API generation with description:", description);
    
//     const response = await fetch(`http://localhost:${PORT}/generate-mock-api`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify({ description })
//     });
    
//     const result = await response.json();
//     console.log("\nGenerated API Specification:");
//     console.log(JSON.stringify(result, null, 2));
    
//   } catch (error) {
//     console.error("\nTest failed:", error);
//   } finally {
//     // Uncomment this line if you want the server to close after testing
//     // server.close();
//   }
// }

// // Run test
// testApiGeneration();