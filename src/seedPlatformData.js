import { pool } from "./db.js";

export async function seedPlatformData() {
  console.log("Seeding platform data (categories, courses, curriculum, quizzes)...");

  // 1. Seed Categories / Learning Paths
  const categories = [
    {
      slug: "digital-literacy",
      name: "Computer and Digital Literacy",
      description: "Essential foundational computing skills, file management, internet safety, operating systems, and office productivity tools.",
      icon: "Laptop",
      sort_order: 1
    },
    {
      slug: "programming",
      name: "Programming Fundamentals",
      description: "Core algorithmic thinking, problem-solving techniques, logic gates, variables, loops, and object-oriented concepts.",
      icon: "Code2",
      sort_order: 2
    },
    {
      slug: "web-development",
      name: "Web Development",
      description: "Building responsive, modern, production-grade web applications with modern frontend and backend technologies.",
      icon: "Globe",
      sort_order: 3
    },
    {
      slug: "career-skills",
      name: "Professional and Career Skills",
      description: "Version control, collaboration workflows, developer tooling, communication, and real-world tech career readiness.",
      icon: "Award",
      sort_order: 4
    }
  ];

  const categoryMap = {};
  for (const cat of categories) {
    const [existing] = await pool.query("SELECT id FROM categories WHERE slug = ?", [cat.slug]);
    let catId;
    if (existing.length > 0) {
      catId = existing[0].id;
      await pool.query(
        "UPDATE categories SET name = ?, description = ?, icon = ?, sort_order = ? WHERE id = ?",
        [cat.name, cat.description, cat.icon, cat.sort_order, catId]
      );
    } else {
      const [res] = await pool.query(
        "INSERT INTO categories (slug, name, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)",
        [cat.slug, cat.name, cat.description, cat.icon, cat.sort_order]
      );
      catId = res.insertId;
    }
    categoryMap[cat.slug] = catId;
  }
  console.log("Categories seeded successfully.");

  // 2. The 6 Demonstration Courses required by the specification
  const coursesData = [
    {
      slug: "computer-and-digital-literacy",
      title: "Introduction to Computer and Digital Literacy",
      category_slug: "digital-literacy",
      difficulty: "beginner",
      duration_hours: 8,
      is_free: true,
      price: 0.00,
      is_published: true,
      is_featured: true,
      format: "online",
      grade_range: "Beginner & All Ages",
      thumbnail_url: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=800&auto=format&fit=crop",
      short_description: "Master modern computing essentials: hardware, operating systems, internet navigation, cloud storage, and cybersecurity best practices.",
      description: "This comprehensive course is designed for absolute beginners and students seeking a strong foundation in digital tools. Learn how computers work under the hood, master mouse and keyboard shortcuts, navigate file systems efficiently, collaborate in the cloud, and defend against phishing and malware threats.",
      instructor_name: "Yohannes Tadesse",
      instructor_title: "Senior Digital Systems Educator",
      instructor_bio: "Yohannes has over 10 years of experience teaching computer science and digital literacy to high school and adult learners across Ethiopia.",
      prerequisites: "No previous computer experience required. Just curiosity and a willingness to learn.",
      learning_objectives: JSON.stringify([
        "Understand computer hardware components: CPU, RAM, storage, and I/O devices",
        "Navigate Windows and Linux operating systems with confidence",
        "Organize files, folders, and master efficient search techniques",
        "Use web browsers, search engines, and evaluate credible online sources",
        "Apply cybersecurity hygiene: passwords, two-factor authentication, and phishing awareness"
      ]),
      target_audience: "Students, career changers, educators, and anyone wanting solid practical computer skills.",
      modules: [
        {
          title: "Module 1: Computing Essentials & Hardware",
          description: "Understanding physical hardware and how computers process information.",
          lessons: [
            {
              title: "Welcome to the Digital World",
              slug: "welcome-digital-world",
              content_type: "article",
              duration_minutes: 15,
              is_preview: true,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Welcome to Computer and Digital Literacy

Computers have transformed every aspect of human life—from commerce and communication to medicine and engineering. Whether you are using a smartphone, desktop, or laptop, you are operating a digital computational system.

### Key Objectives for this Session:
1. Identify the input, process, output, and storage model (IPOS).
2. Differentiate between hardware components and operating systems.
3. Establish safe ergonomics and posture while computing.

### The IPOS Cycle
Every computer performs four fundamental operations:
- **Input:** Receiving data from keyboards, mice, touchscreens, or microphones.
- **Processing:** Transforming input data through the Central Processing Unit (CPU).
- **Storage:** Persisting data either temporarily in RAM or permanently in Solid State Drives (SSD) or Hard Disk Drives (HDD).
- **Output:** Presenting calculated results through monitors, speakers, or printers.

Take a few moments to review your workstation setup, ensure your screen is at eye level, and get ready for hands-on practice in the next lesson!`
            },
            {
              title: "Understanding CPU, RAM, and Storage",
              slug: "cpu-ram-storage",
              content_type: "video",
              duration_minutes: 20,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Inside the Computer: Processing & Memory

To understand why your computer runs fast or slows down, you must understand three critical components:

### 1. Central Processing Unit (CPU)
The CPU is the "brain" of the computer. It executes billions of electrical cycles per second (measured in Gigahertz, GHz). When you click a button or play a video, the CPU coordinates the instructions.

### 2. Random Access Memory (RAM)
RAM is the computer's short-term desk space. When you open an app or browser tab, it is loaded into RAM for instantaneous access. However, RAM is **volatile**: turning off your computer clears RAM completely.

### 3. Persistent Storage (SSD vs. HDD)
- **SSDs (Solid State Drives):** Use flash memory chips with zero moving parts, providing lightning-fast boot and load times.
- **HDDs (Hard Disk Drives):** Use spinning magnetic platters. They are cheaper for massive backups but significantly slower.

> **Tip:** If your computer feels sluggish when having multiple browser tabs open, increasing your RAM is usually the most impactful upgrade!`
            }
          ]
        },
        {
          title: "Module 2: Internet, Cloud & Digital Safety",
          description: "Navigating the web safely and safeguarding personal information.",
          lessons: [
            {
              title: "Web Browsing & Search Engine Mastery",
              slug: "web-browsing-mastery",
              content_type: "article",
              duration_minutes: 25,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Browsing and Research Skills

Finding verified, accurate information online is a critical 21st-century capability.

### Essential Google Search Operators:
- \`"exact phrase"\`: Search for the exact string of words.
- \`site:gov.et\` or \`site:edu\`: Restrict results to a specific domain or educational portal.
- \`filetype:pdf\`: Find authoritative reports and whitepapers directly.
- \`-word\`: Exclude unrelated terms from your search query.

### Identifying Secure Websites:
Look for **HTTPS** and the padlock icon in the browser address bar. HTTPS encrypts the traffic between your device and the server, protecting passwords and credit card information from interception.`
            },
            {
              title: "Cybersecurity Basics: Defending Your Accounts",
              slug: "cybersecurity-basics",
              content_type: "article",
              duration_minutes: 20,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Protecting Yourself from Online Threats

Digital safety is not about paranoia; it is about good digital habits.

### Top Golden Rules:
1. **Never reuse passwords:** Use a password manager like Bitwarden or 1Password to generate 16+ character distinct passwords.
2. **Turn on 2FA (Two-Factor Authentication):** Always enable app-based 2FA (Google Authenticator) on your email and banking portals.
3. **Beware of Phishing:** Financial institutions will never send urgent emails asking you to click an unverified link to reset your PIN.
4. **Keep Software Updated:** Security patches fix discovered vulnerabilities before attackers can exploit them.`
            }
          ]
        }
      ],
      quiz: {
        title: "Digital Literacy Knowledge Check",
        description: "Test your understanding of computer hardware, memory, and internet safety.",
        passing_score: 75,
        time_limit_minutes: 15,
        questions: [
          {
            text: "Which computer component serves as volatile short-term working memory?",
            explanation: "RAM (Random Access Memory) holds active programs and data temporarily. When power is lost, its contents are cleared.",
            options: [
              { text: "Solid State Drive (SSD)", is_correct: false },
              { text: "Random Access Memory (RAM)", is_correct: true },
              { text: "Central Processing Unit (CPU)", is_correct: false },
              { text: "Optical Disc Drive", is_correct: false }
            ]
          },
          {
            text: "What does the 'S' in HTTPS signify?",
            explanation: "HTTPS stands for Hypertext Transfer Protocol Secure, indicating that communication between browser and server is encrypted using TLS/SSL.",
            options: [
              { text: "Speed", is_correct: false },
              { text: "Secure", is_correct: true },
              { text: "Standard", is_correct: false },
              { text: "System", is_correct: false }
            ]
          },
          {
            text: "Which of the following is the most secure method for account protection?",
            explanation: "Unique strong passwords combined with multi-factor authentication (2FA) provide resilient defense against credential stuffing and brute-force attacks.",
            options: [
              { text: "Using your pet's name for all accounts so you don't forget it", is_correct: false },
              { text: "A unique strong password combined with Two-Factor Authentication (2FA)", is_correct: true },
              { text: "Writing passwords on a sticky note attached to your monitor", is_correct: false },
              { text: "Disabling browser security warnings", is_correct: false }
            ]
          },
          {
            text: "What search operator would you use to find results exclusively from Ethiopian government sites?",
            explanation: "The 'site:' operator filters query results to a specific top-level domain or hostname, such as 'site:gov.et'.",
            options: [
              { text: "filter:gov.et", is_correct: false },
              { text: "site:gov.et", is_correct: true },
              { text: "domain=gov.et", is_correct: false },
              { text: "inurl.et", is_correct: false }
            ]
          }
        ]
      }
    },
    {
      slug: "html-and-css-fundamentals",
      title: "HTML and CSS Fundamentals",
      category_slug: "web-development",
      difficulty: "beginner",
      duration_hours: 12,
      is_free: true,
      price: 0.00,
      is_published: true,
      is_featured: true,
      format: "online",
      grade_range: "Beginner",
      thumbnail_url: "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?q=80&w=800&auto=format&fit=crop",
      short_description: "Learn to build modern, semantic, accessible, and responsive web pages from scratch using HTML5 and modern CSS3 (Flexbox & Grid).",
      description: "Every web page on the internet starts with HTML and CSS. In this hands-on course, you will learn how to structure content using modern semantic tags, style pages with beautiful typography and color palettes, master responsive layouts with CSS Flexbox and CSS Grid, and build real-world mobile-friendly landing pages.",
      instructor_name: "Bethlehem Haile",
      instructor_title: "Lead Frontend Engineer",
      instructor_bio: "Bethlehem has built accessible web experiences for fintech and educational startups, and is passionate about mentoring junior developers.",
      prerequisites: "Basic familiarity with using a computer and text editor.",
      learning_objectives: JSON.stringify([
        "Master semantic HTML5 markup for accessibility and search engine optimization",
        "Understand the CSS Box Model (content, padding, border, margin)",
        "Build fluid layouts using CSS Flexbox for 1D and CSS Grid for 2D positioning",
        "Write media queries to make websites look stunning on phones, tablets, and desktops",
        "Deploy a real responsive portfolio page to the web"
      ]),
      target_audience: "Aspiring web designers, front-end developers, students, and digital creators.",
      modules: [
        {
          title: "Module 1: Semantic HTML5 Structure",
          description: "Writing meaningful, accessible document architecture.",
          lessons: [
            {
              title: "Introduction to HTML5 & Document Anatomy",
              slug: "html5-document-anatomy",
              content_type: "article",
              duration_minutes: 20,
              is_preview: true,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# The Anatomy of an HTML5 Document

HTML stands for **HyperText Markup Language**. It provides the raw skeleton of web content.

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My First Web Page</title>
</head>
<body>
  <header>
    <h1>Ethio Techbridge Academy</h1>
    <nav>
      <ul>
        <li><a href="#about">About</a></li>
        <li><a href="#courses">Courses</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <article>
      <h2>Welcome Learners!</h2>
      <p>Start your coding journey with practical exercises.</p>
    </article>
  </main>
  <footer>
    <p>&copy; 2026 Ethio Techbridge Academy. All rights reserved.</p>
  </footer>
</body>
</html>
\`\`\`

### Semantic Tags vs. Non-Semantic Tags
- Semantic elements like \`<header>\`, \`<nav>\`, \`<main>\`, \`<article>\`, \`<section>\`, and \`<footer>\` clearly describe their meaning to both browser and developer.
- Screen readers use these tags to allow visually impaired users to jump to landmarks effortlessly.`
            },
            {
              title: "Working with Forms, Inputs & Media",
              slug: "html-forms-and-media",
              content_type: "article",
              duration_minutes: 25,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Building Accessible HTML Forms

Forms allow users to communicate with servers. Always pair \`<label>\` elements with \`<input>\` IDs!

\`\`\`html
<form action="/api/submit" method="POST">
  <div class="field-group">
    <label for="studentEmail">Email Address:</label>
    <input type="email" id="studentEmail" name="email" required placeholder="you@example.com">
  </div>
  <button type="submit">Submit Application</button>
</form>
\`\`\`

> **Accessibility Note:** Clicking the label automatically focuses the corresponding input field, vastly improving mobile usability.`
            }
          ]
        },
        {
          title: "Module 2: Modern CSS3 Layouts & Responsive Design",
          description: "Flexbox, Grid, and mobile-first responsive styling.",
          lessons: [
            {
              title: "Mastering the CSS Box Model",
              slug: "css-box-model",
              content_type: "article",
              duration_minutes: 20,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# The CSS Box Model

Every element on a web page is rendered as a rectangular box consisting of:
1. **Content:** The actual text, image, or video.
2. **Padding:** Transparent spacing surrounding the content inside the border.
3. **Border:** A border surrounding the padding.
4. **Margin:** Spacing outside the border that separates the element from neighbours.

\`\`\`css
* {
  box-sizing: border-box; /* Crucial best practice! */
}

.card {
  width: 320px;
  padding: 1.5rem;
  border: 1px solid #E2E8F0;
  border-radius: 0.75rem;
  margin: 1rem auto;
  background-color: #FFFFFF;
}
\`\`\`

Using \`box-sizing: border-box\` ensures padding and borders are included within the element's specified width, eliminating unexpected overflow.`
            },
            {
              title: "Flexbox & CSS Grid for Responsive Design",
              slug: "flexbox-and-grid",
              content_type: "article",
              duration_minutes: 30,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Modern Responsive Layouts: Flexbox vs Grid

### When to use Flexbox (1D layouts):
Use Flexbox when arranging items along a single axis (either row or column), such as navigation bars, form controls, and centering elements.

\`\`\`css
.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
\`\`\`

### When to use CSS Grid (2D layouts):
Use CSS Grid when building complex two-dimensional layouts containing both rows and columns, such as course catalogs and dashboard widgets.

\`\`\`css
.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}
\`\`\`

With \`repeat(auto-fit, minmax(280px, 1fr))\`, the grid automatically reflows to 1 column on phones, 2 columns on tablets, and 3-4 columns on desktops without writing a single media query!`
            }
          ]
        }
      ],
      quiz: {
        title: "HTML & CSS Fundamentals Quiz",
        description: "Verify your mastery of semantic HTML, the Box Model, and responsive CSS.",
        passing_score: 75,
        time_limit_minutes: 20,
        questions: [
          {
            text: "Which HTML5 element represents the primary navigation links of a website?",
            explanation: "The <nav> semantic tag identifies major navigation blocks for browsers and assistive technologies.",
            options: [
              { text: "<navigation>", is_correct: false },
              { text: "<nav>", is_correct: true },
              { text: "<menu-bar>", is_correct: false },
              { text: "<links>", is_correct: false }
            ]
          },
          {
            text: "What does 'box-sizing: border-box' do?",
            explanation: "It includes padding and border within the element's total declared width and height, preventing unexpected horizontal overflows.",
            options: [
              { text: "It removes all borders from elements", is_correct: false },
              { text: "It includes padding and border in the element's total width and height", is_correct: true },
              { text: "It forces the box to be circular", is_correct: false },
              { text: "It doubles the element margin", is_correct: false }
            ]
          },
          {
            text: "Which CSS property enables a 2D grid layout with rows and columns?",
            explanation: "Setting 'display: grid' activates CSS Grid layout capabilities on a container.",
            options: [
              { text: "display: flex", is_correct: false },
              { text: "display: grid", is_correct: true },
              { text: "display: table-cell", is_correct: false },
              { text: "layout: matrix", is_correct: false }
            ]
          },
          {
            text: "Why should an <input> element be associated with a <label>?",
            explanation: "Associating labels improves accessibility for screen readers and allows users to click the label to focus the input on mobile devices.",
            options: [
              { text: "It is required for CSS styling only", is_correct: false },
              { text: "It provides accessibility for screen readers and expands the clickable target area", is_correct: true },
              { text: "It automatically submits the form without a button", is_correct: false },
              { text: "It encrypts the input value automatically", is_correct: false }
            ]
          }
        ]
      }
    },
    {
      slug: "javascript-programming-basics",
      title: "JavaScript Programming Basics",
      category_slug: "programming",
      difficulty: "beginner",
      duration_hours: 14,
      is_free: true,
      price: 0.00,
      is_published: true,
      is_featured: true,
      format: "online",
      grade_range: "Beginner",
      thumbnail_url: "https://images.unsplash.com/photo-1579468118864-1b9ea3c0db4a?q=80&w=800&auto=format&fit=crop",
      short_description: "Unlock the engine of the modern web: variables, arrays, objects, functions, DOM manipulation, events, and modern ES6+ features.",
      description: "JavaScript is the programming language that powers interactive behavior across all modern browsers and servers. In this course, you will learn computational thinking from the ground up: variables, conditionals, loops, functions, array methods (map, filter, reduce), manipulating the Document Object Model (DOM), handling user interactions, and working with asynchronous fetch requests.",
      instructor_name: "Dawit Kebede",
      instructor_title: "Full-Stack Software Architect",
      instructor_bio: "Dawit has built distributed microservices and rich single-page web applications. He loves breaking down complex algorithms into intuitive steps.",
      prerequisites: "Basic understanding of HTML and CSS.",
      learning_objectives: JSON.stringify([
        "Understand data types, variables (const, let), and scope in JavaScript",
        "Implement control flow with conditional logic and loops",
        "Write reusable functions, arrow functions, and higher-order array methods",
        "Select and dynamically manipulate DOM elements in response to events",
        "Fetch JSON data from REST APIs using async/await"
      ]),
      target_audience: "Anyone eager to create dynamic web applications, interactive games, or prepare for modern frameworks like React.",
      modules: [
        {
          title: "Module 1: JavaScript Fundamentals & Control Flow",
          description: "Variables, primitive types, conditionals, and functions.",
          lessons: [
            {
              title: "Variables, Data Types & Operations",
              slug: "variables-and-data-types",
              content_type: "article",
              duration_minutes: 25,
              is_preview: true,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# JavaScript Essentials: Variables and Data Types

In modern JavaScript (ES6+), we use \`const\` and \`let\` to declare variables:

- **\`const\`**: Used for values that will not be reassigned. Always default to \`const\`!
- **\`let\`**: Used when a variable's value needs to change over time (such as counters in loops).

\`\`\`javascript
const academyName = "Ethio Techbridge Academy";
let studentCount = 120;
studentCount += 5;

// Primitive types: String, Number, Boolean, Null, Undefined, BigInt, Symbol
const isEnrolled = true;
const price = 0;
const greeting = \`Welcome to \${academyName}! Current students: \${studentCount}\`;
console.log(greeting);
\`\`\`

### Strict Equality (\`===\` vs \`==\`)
Always use strict equality (\`===\`) because it checks both value and type without performing unwanted type coercion.`
            },
            {
              title: "Functions, Arrow Syntax & Array Methods",
              slug: "functions-and-arrays",
              content_type: "article",
              duration_minutes: 30,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Higher-Order Array Methods in JavaScript

Instead of writing classic \`for\` loops, modern JavaScript developers leverage array transformations:

\`\`\`javascript
const scores = [85, 92, 78, 96, 64];

// 1. Filter: find passing grades (>= 75)
const passingScores = scores.filter(score => score >= 75);
console.log(passingScores); // [85, 92, 96]

// 2. Map: transform elements
const letterGrades = scores.map(score => {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  return "C";
});

// 3. Reduce: calculate average
const total = scores.reduce((sum, current) => sum + current, 0);
const average = total / scores.length;
console.log("Class Average:", average);
\`\`\`

Higher-order methods produce clean, declarative, readable code with fewer bugs.`
            }
          ]
        },
        {
          title: "Module 2: The DOM & Asynchronous JavaScript",
          description: "Connecting JavaScript to HTML and communicating with backend APIs.",
          lessons: [
            {
              title: "DOM Selection, Manipulation & Event Listeners",
              slug: "dom-manipulation-events",
              content_type: "article",
              duration_minutes: 30,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Bringing Web Pages to Life with the DOM

The Document Object Model (DOM) is an object-oriented representation of the web page.

\`\`\`javascript
// Select elements
const enrollButton = document.querySelector("#btn-enroll");
const statusBadge = document.querySelector(".status-badge");

// Listen for clicks
enrollButton.addEventListener("click", (event) => {
  event.preventDefault();
  statusBadge.textContent = "Enrollment Active!";
  statusBadge.classList.add("bg-green-500", "text-white");
});
\`\`\`

Handling events like \`click\`, \`submit\`, \`keydown\`, and \`input\` enables rich, responsive user interactions.`
            },
            {
              title: "Async/Await and REST API Data Fetching",
              slug: "async-await-fetch",
              content_type: "article",
              duration_minutes: 30,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Consuming REST APIs with fetch and async/await

Web applications dynamically fetch data from servers without reloading the page.

\`\`\`javascript
async function loadPublishedCourses() {
  try {
    const response = await fetch("/api/courses");
    if (!response.ok) {
      throw new Error("HTTP error " + response.status);
    }
    const data = await response.json();
    console.log("Received courses:", data.courses);
    return data.courses;
  } catch (error) {
    console.error("Failed to load courses:", error.message);
    alert("Unable to fetch courses right now.");
  }
}
\`\`\`

Always wrap asynchronous network requests in a \`try...catch\` block to handle network disconnections gracefully.`
            }
          ]
        }
      ],
      quiz: {
        title: "JavaScript Basics Assessment",
        description: "Test your understanding of JavaScript variables, array methods, and asynchronous code.",
        passing_score: 75,
        time_limit_minutes: 20,
        questions: [
          {
            text: "Which keyword should be used by default to declare a variable that is not meant to be reassigned?",
            explanation: "'const' creates an immutable binding in JavaScript and should be your default choice.",
            options: [
              { text: "var", is_correct: false },
              { text: "const", is_correct: true },
              { text: "let", is_correct: false },
              { text: "static", is_correct: false }
            ]
          },
          {
            text: "What will '[1, 2, 3].map(x => x * 2)' return?",
            explanation: "The .map() method transforms each element in the array, producing [2, 4, 6].",
            options: [
              { text: "[1, 2, 3]", is_correct: false },
              { text: "[2, 4, 6]", is_correct: true },
              { text: "6", is_correct: false },
              { text: "[2, 2, 2]", is_correct: false }
            ]
          },
          {
            text: "What is the difference between '==' and '===' in JavaScript?",
            explanation: "'===' checks both value and type without performing implicit type coercion, whereas '==' performs type conversion.",
            options: [
              { text: "They are completely identical", is_correct: false },
              { text: "'===' checks both value and type without implicit coercion", is_correct: true },
              { text: "'==' is faster than '==='", is_correct: false },
              { text: "'===' is only for strings", is_correct: false }
            ]
          },
          {
            text: "What keyword pauses an asynchronous function until a Promise resolves?",
            explanation: "The 'await' keyword pauses execution inside an 'async' function until the promise is settled.",
            options: [
              { text: "pause", is_correct: false },
              { text: "wait", is_correct: false },
              { text: "await", is_correct: true },
              { text: "sleep", is_correct: false }
            ]
          }
        ]
      }
    },
    {
      slug: "introduction-to-python-programming",
      title: "Introduction to Python Programming",
      category_slug: "programming",
      difficulty: "beginner",
      duration_hours: 15,
      is_free: true,
      price: 0.00,
      is_published: true,
      is_featured: true,
      format: "online",
      grade_range: "Beginner",
      thumbnail_url: "https://images.unsplash.com/photo-1526379095098-d400fd0bf935?q=80&w=800&auto=format&fit=crop",
      short_description: "Learn Python syntax, data structures (lists, dicts, tuples), file handling, modular programming, and write real scripts and automation tools.",
      description: "Python is universally celebrated for its clear, readable syntax and immense power across data science, web backends, automation, and artificial intelligence. This course introduces you to variables, control structures, functions, lists, dictionaries, error handling, and writing practical Python scripts.",
      instructor_name: "Selamawit Girma",
      instructor_title: "Python Software Developer & AI Researcher",
      instructor_bio: "Selamawit specializes in Python backend systems and data analytics, with active research in natural language processing.",
      prerequisites: "No previous programming experience required.",
      learning_objectives: JSON.stringify([
        "Write clean, idiomatic Python adhering to PEP 8 standards",
        "Work with fundamental data structures: lists, tuples, sets, and dictionaries",
        "Implement functions, default arguments, and return values",
        "Read and write data from text and CSV files on disk",
        "Handle runtime exceptions safely using try/except blocks"
      ]),
      target_audience: "Students, data enthusiasts, and future software engineers looking for a friendly first language.",
      modules: [
        {
          title: "Module 1: Python Basics & Collections",
          description: "Syntax fundamentals, indentation, variables, and data structures.",
          lessons: [
            {
              title: "Python Syntax, Variables & Types",
              slug: "python-syntax-variables",
              content_type: "article",
              duration_minutes: 25,
              is_preview: true,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Welcome to Python 3!

Python is renowned for its elegant, indentation-based syntax. Unlike C++ or Java, Python uses whitespace instead of curly braces to define code blocks.

\`\`\`python
# Simple Python script
student_name = "Abebe Bikila"
age = 18
is_graduated = False

if age >= 18:
    print(f"{student_name} is eligible for advanced academy tracks!")
else:
    print(f"{student_name} is enrolled in the junior track.")
\`\`\`

### Key Data Types in Python:
- **\`int\` / \`float\`:** Numbers (\`42\`, \`3.1415\`)
- **\`str\`:** Strings formatted with f-strings (\`f"Score: {score}"\`)
- **\`bool\`:** Boolean flags (\`True\`, \`False\`)`
            },
            {
              title: "Lists, Dictionaries and Iteration",
              slug: "lists-and-dictionaries",
              content_type: "article",
              duration_minutes: 30,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Powerful Python Collections: Lists & Dictionaries

### Lists (Ordered, mutable sequences):
\`\`\`python
courses = ["Digital Literacy", "Web Development", "Python Basics"]
courses.append("Data Science")
print("First course:", courses[0])

for index, course in enumerate(courses, start=1):
    print(f"{index}. {course}")
\`\`\`

### Dictionaries (Key-Value mappings):
\`\`\`python
student = {
    "name": "Marta Mekonnen",
    "grade": 11,
    "completed_lessons": 8,
    "has_certificate": True
}

print(student.get("name"))
print(f"Completed: {student['completed_lessons']} lessons")
\`\`\``
            }
          ]
        },
        {
          title: "Module 2: Functions, File I/O & Error Handling",
          description: "Building reusable functions and safe scripts.",
          lessons: [
            {
              title: "Writing Modular Functions & Handling Exceptions",
              slug: "functions-and-exceptions",
              content_type: "article",
              duration_minutes: 25,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Clean Functions and Robust Error Handling

\`\`\`python
def calculate_progress(completed: int, total: int) -> float:
    """Calculates percentage completion with safe error checking."""
    try:
        if total <= 0:
            raise ValueError("Total lessons must be greater than zero.")
        percentage = (completed / total) * 100
        return round(percentage, 1)
    except ZeroDivisionError:
        return 0.0
    except TypeError:
        print("Invalid data type passed to calculate_progress.")
        return 0.0

print("Progress:", calculate_progress(7, 10), "%")
\`\`\`

Clean exception handling prevents programs from crashing unexpectedly when given unexpected user inputs.`
            }
          ]
        }
      ],
      quiz: {
        title: "Python Basics Checkpoint",
        description: "Assess your knowledge of Python syntax, data types, and function definitions.",
        passing_score: 75,
        time_limit_minutes: 15,
        questions: [
          {
            text: "How does Python delimit blocks of code (like loops and functions)?",
            explanation: "Python enforces whitespace indentation (typically 4 spaces) rather than curly braces to define code blocks.",
            options: [
              { text: "Curly braces {}", is_correct: false },
              { text: "Indentation (whitespace)", is_correct: true },
              { text: "Semicolons ;", is_correct: false },
              { text: "Parentheses ()", is_correct: false }
            ]
          },
          {
            text: "Which data structure stores key-value pairs in Python?",
            explanation: "Dictionaries ('dict') store data as mappings of unique keys to values, e.g. {'name': 'Sara'}.",
            options: [
              { text: "list", is_correct: false },
              { text: "dictionary (dict)", is_correct: true },
              { text: "tuple", is_correct: false },
              { text: "set", is_correct: false }
            ]
          },
          {
            text: "What keyword is used to define a function in Python?",
            explanation: "Functions in Python are defined using the 'def' keyword followed by the function name and parameters.",
            options: [
              { text: "function", is_correct: false },
              { text: "def", is_correct: true },
              { text: "fun", is_correct: false },
              { text: "define", is_correct: false }
            ]
          }
        ]
      }
    },
    {
      slug: "git-and-github-essentials",
      title: "Git and GitHub Essentials",
      category_slug: "career-skills",
      difficulty: "beginner",
      duration_hours: 10,
      is_free: true,
      price: 0.00,
      is_published: true,
      is_featured: true,
      format: "online",
      grade_range: "Beginner",
      thumbnail_url: "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?q=80&w=800&auto=format&fit=crop",
      short_description: "Master version control: commits, branches, merge conflicts, pull requests, and collaborative team workflows on GitHub.",
      description: "Version control is the lifeblood of modern software engineering. Without Git, collaborating on code is chaotic. In this course, you will learn the mental model of Git, commit changes with meaningful messages, branch and merge features, resolve merge conflicts like a pro, and publish your projects to GitHub.",
      instructor_name: "Yared Solomon",
      instructor_title: "DevOps & Cloud Engineer",
      instructor_bio: "Yared manages cloud infrastructure and automated CI/CD pipelines, training engineering teams on Git collaboration.",
      prerequisites: "Basic command line or terminal familiarity.",
      learning_objectives: JSON.stringify([
        "Understand the distributed Git model (Working Directory, Staging, Local Repo, Remote)",
        "Master everyday commands: init, add, commit, status, log, diff",
        "Create, switch, and merge Git branches safely",
        "Resolve merge conflicts with confidence",
        "Collaborate on GitHub with forks, pull requests, and code reviews"
      ]),
      target_audience: "Developers, students, data scientists, and team contributors.",
      modules: [
        {
          title: "Module 1: Git Core Mental Model",
          description: "Tracking changes and committing history.",
          lessons: [
            {
              title: "What is Git & The Three States",
              slug: "git-three-states",
              content_type: "article",
              duration_minutes: 20,
              is_preview: true,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Understanding the Three States of Git

Git tracks changes in a repository through three key areas:

1. **Working Directory:** The physical files on your hard drive you are currently editing.
2. **Staging Area (Index):** The preview area where you choose which changes to include in the next commit.
3. **Git Repository (History):** The permanent database containing verified snapshots of your project.

\`\`\`bash
# Check status of changed files
git status

# Stage specific changes
git add src/App.jsx

# Commit with a clear, imperative message
git commit -m "Add responsive mobile navigation menu"
\`\`\`

A commit is an immutable cryptographic snapshot of your codebase at a specific point in time.`
            },
            {
              title: "Branching, Merging & Remote Repositories",
              slug: "branching-and-github",
              content_type: "article",
              duration_minutes: 25,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Team Collaboration: Branches and GitHub

Never work directly on the \`main\` branch in a team setting. Create isolated feature branches!

\`\`\`bash
# Create and switch to a feature branch
git checkout -b feature/quiz-grading

# Push feature branch to GitHub
git push -u origin feature/quiz-grading
\`\`\`

### The GitHub Pull Request Flow:
1. Open a **Pull Request (PR)** on GitHub.
2. Teammates review the code diff and provide feedback.
3. Automated continuous integration (CI) tests run.
4. Merge the pull request cleanly into \`main\`.`
            }
          ]
        }
      ],
      quiz: {
        title: "Git & Version Control Checkpoint",
        description: "Verify your mastery of commits, staging, and branch workflows.",
        passing_score: 75,
        time_limit_minutes: 15,
        questions: [
          {
            text: "Which command moves changes from the working directory into the staging area?",
            explanation: "'git add' stages changes preparing them for the next commit snapshot.",
            options: [
              { text: "git push", is_correct: false },
              { text: "git add", is_correct: true },
              { text: "git commit", is_correct: false },
              { text: "git stage-all", is_correct: false }
            ]
          },
          {
            text: "What does 'git checkout -b new-feature' do?",
            explanation: "The -b flag instructs Git to create a new branch named 'new-feature' and immediately switch to it.",
            options: [
              { text: "Deletes a branch", is_correct: false },
              { text: "Creates and switches to a new branch", is_correct: true },
              { text: "Backs up the current commit", is_correct: false },
              { text: "Pushes changes to remote origin", is_correct: false }
            ]
          },
          {
            text: "What is a Pull Request (PR) on GitHub?",
            explanation: "A Pull Request proposes merging code changes from a feature branch into the target branch, allowing team review and discussion.",
            options: [
              { text: "A command to pull down code to your computer", is_correct: false },
              { text: "A formal proposal to review and merge code changes into a branch", is_correct: true },
              { text: "A payment request for developers", is_correct: false },
              { text: "An error message indicating failed download", is_correct: false }
            ]
          }
        ]
      }
    },
    {
      slug: "full-stack-web-development-roadmap",
      title: "Full-Stack Web Development Roadmap",
      category_slug: "web-development",
      difficulty: "intermediate",
      duration_hours: 20,
      is_free: true,
      price: 0.00,
      is_published: true,
      is_featured: true,
      format: "online",
      grade_range: "Beginner to Intermediate",
      thumbnail_url: "https://images.unsplash.com/photo-1571171637578-41bc2dd41cd2?q=80&w=800&auto=format&fit=crop",
      short_description: "Understand the complete full-stack landscape: client-server architecture, REST APIs, relational databases, authentication, and cloud deployment.",
      description: "How does a full-stack web application actually work from browser click to database query? This course connects all the dots: HTTP request/response lifecycles, Express & Node.js backends, MySQL relational schema design, JWT authentication, state management, and modern cloud deployment on Vercel and Railway.",
      instructor_name: "Dawit Kebede & Bethlehem Haile",
      instructor_title: "Curriculum Directors",
      instructor_bio: "Co-authored by senior engineers at Ethio Techbridge Academy to prepare students for real-world software engineering careers.",
      prerequisites: "Familiarity with HTML, CSS, and introductory JavaScript.",
      learning_objectives: JSON.stringify([
        "Understand client-server architecture and the HTTP/HTTPS protocol",
        "Design normalized relational database schemas with foreign keys and indexes",
        "Build secure RESTful endpoints in Node.js and Express",
        "Implement JSON Web Token (JWT) stateless authentication",
        "Deploy frontends to Vercel and production databases to cloud providers"
      ]),
      target_audience: "Aspiring full-stack engineers, bootcamp students, and self-taught developers ready to build complete systems.",
      modules: [
        {
          title: "Module 1: Architecture & Server Foundations",
          description: "Client-server model, REST APIs, and database fundamentals.",
          lessons: [
            {
              title: "The Client-Server Lifecycle & HTTP",
              slug: "client-server-lifecycle",
              content_type: "article",
              duration_minutes: 25,
              is_preview: true,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Anatomy of a Full-Stack Web Request

When a user clicks "Enroll in Course" in their browser, here is what happens:

1. **DNS Resolution:** The domain name (\`ethtechbridgeacademy.com\`) is converted into an IP address.
2. **TLS Handshake:** Secure HTTPS encryption is negotiated.
3. **HTTP Request:** The browser sends a \`POST /api/courses/1/enroll\` with headers including \`Authorization: Bearer <token>\`.
4. **Backend Processing:** Express middleware validates the token, extracts the authenticated user ID, and issues a parameterized SQL query:
   \`\`\`sql
   INSERT INTO enrollments (user_id, course_id) VALUES (?, ?);
   \`\`\`
5. **Database Execution:** MySQL verifies foreign keys and writes the row.
6. **HTTP Response:** The server returns HTTP \`201 Created\` with JSON: \`{ "message": "Enrolled successfully" }\`.
7. **Frontend State Update:** React catches the response and updates UI state without reloading the page!`
            },
            {
              title: "Relational Database Design with MySQL",
              slug: "relational-database-design",
              content_type: "article",
              duration_minutes: 30,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Designing Normalized Relational Schemas

A robust web application relies on data integrity. Never store unstructured duplicate data when relations can model it cleanly.

### Cardinality Types:
- **One-to-Many (1:N):** One Course has many Lessons. Modeled with a \`course_id\` foreign key on the \`lessons\` table.
- **Many-to-Many (M:N):** Many Students can enroll in many Courses. Modeled using a junction table like \`enrollments\` containing \`user_id\` and \`course_id\` with a \`UNIQUE(user_id, course_id)\` constraint.

### Indexes & Performance:
Always add indexes to columns frequently queried in \`WHERE\` or \`JOIN\` clauses (such as \`user_id\`, \`email\`, and \`created_at\`).`
            }
          ]
        },
        {
          title: "Module 2: Authentication, Security & Deployment",
          description: "JWT authentication, OWASP security best practices, and Vercel hosting.",
          lessons: [
            {
              title: "Secure Authentication with Bcrypt & JWT",
              slug: "secure-auth-jwt",
              content_type: "article",
              duration_minutes: 30,
              is_preview: false,
              video_url: "https://www.youtube.com/watch?v=kUMe1FH4CHE",
              content_text: `# Production Authentication Standards

Never store plain text passwords. Always use salted, adaptive hashing functions like **bcrypt**:

\`\`\`javascript
// Secure hashing during registration
const saltRounds = 12;
const passwordHash = await bcrypt.hash(rawPassword, saltRounds);

// Comparison during login
const isMatch = await bcrypt.compare(rawPassword, storedHash);
\`\`\`

### Protecting API Endpoints:
Use JSON Web Tokens (JWT) signed with a secret of at least 32 random characters. On protected routes, extract the token and verify before fulfilling requests.`
            }
          ]
        }
      ],
      quiz: {
        title: "Full-Stack Architecture Mastery Quiz",
        description: "Verify your understanding of web protocols, database relations, and authentication.",
        passing_score: 75,
        time_limit_minutes: 20,
        questions: [
          {
            text: "What HTTP method should be used when creating a new resource on the server?",
            explanation: "POST is the standard idempotent/creation HTTP verb for creating new resources.",
            options: [
              { text: "GET", is_correct: false },
              { text: "POST", is_correct: true },
              { text: "DELETE", is_correct: false },
              { text: "HEAD", is_correct: false }
            ]
          },
          {
            text: "How is a Many-to-Many relationship modeled between Users and Courses in a relational database?",
            explanation: "A junction or associative table (such as 'enrollments') connects user IDs and course IDs.",
            options: [
              { text: "By storing a comma-separated list of course IDs inside a user column", is_correct: false },
              { text: "Using a junction/enrollments table with foreign keys referencing both tables", is_correct: true },
              { text: "It cannot be modeled in relational databases", is_correct: false },
              { text: "By duplicating user records for every course", is_correct: false }
            ]
          },
          {
            text: "Why is bcrypt preferred over MD5 or SHA-256 for password storage?",
            explanation: "Bcrypt is an adaptive key derivation function with configurable work factor (salt rounds), resisting GPU brute-force and rainbow table attacks.",
            options: [
              { text: "Bcrypt is reversible and allows recovering lost passwords", is_correct: false },
              { text: "Bcrypt is computationally intensive with salting, making brute-force attacks infeasible", is_correct: true },
              { text: "Bcrypt produces shorter strings", is_correct: false },
              { text: "Bcrypt is built directly into HTML5", is_correct: false }
            ]
          }
        ]
      }
    }
  ];

  for (const c of coursesData) {
    const categoryId = categoryMap[c.category_slug] || null;

    // Check if course exists by slug
    const [existing] = await pool.query("SELECT id FROM courses WHERE slug = ?", [c.slug]);
    let courseId;

    if (existing.length > 0) {
      courseId = existing[0].id;
      await pool.query(
        `UPDATE courses 
         SET title = ?, short_description = ?, description = ?, category_id = ?, difficulty = ?,
             duration_hours = ?, thumbnail_url = ?, instructor_name = ?, instructor_title = ?,
             instructor_bio = ?, prerequisites = ?, learning_objectives = ?, target_audience = ?,
             price = ?, is_free = ?, is_published = ?, is_featured = ?, format = ?, grade_range = ?
         WHERE id = ?`,
        [
          c.title, c.short_description, c.description, categoryId, c.difficulty,
          c.duration_hours, c.thumbnail_url, c.instructor_name, c.instructor_title,
          c.instructor_bio, c.prerequisites, c.learning_objectives, c.target_audience,
          c.price, c.is_free, c.is_published, c.is_featured, c.format, c.grade_range,
          courseId
        ]
      );
      console.log(`Updated course: ${c.title}`);
    } else {
      const [res] = await pool.query(
        `INSERT INTO courses 
         (slug, title, short_description, description, category_id, difficulty, duration_hours,
          thumbnail_url, instructor_name, instructor_title, instructor_bio, prerequisites,
          learning_objectives, target_audience, price, is_free, is_published, is_featured, format, grade_range)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.slug, c.title, c.short_description, c.description, categoryId, c.difficulty, c.duration_hours,
          c.thumbnail_url, c.instructor_name, c.instructor_title, c.instructor_bio, c.prerequisites,
          c.learning_objectives, c.target_audience, c.price, c.is_free, c.is_published, c.is_featured, c.format, c.grade_range
        ]
      );
      courseId = res.insertId;
      console.log(`Inserted course: ${c.title} (ID: ${courseId})`);
    }

    // Seed modules and lessons
    let moduleOrder = 1;
    for (const mod of c.modules) {
      const [existingMod] = await pool.query(
        "SELECT id FROM course_modules WHERE course_id = ? AND title = ?",
        [courseId, mod.title]
      );
      let moduleId;
      if (existingMod.length > 0) {
        moduleId = existingMod[0].id;
        await pool.query(
          "UPDATE course_modules SET description = ?, sort_order = ? WHERE id = ?",
          [mod.description, moduleOrder, moduleId]
        );
      } else {
        const [modRes] = await pool.query(
          "INSERT INTO course_modules (course_id, title, description, sort_order) VALUES (?, ?, ?, ?)",
          [courseId, mod.title, mod.description, moduleOrder]
        );
        moduleId = modRes.insertId;
      }
      moduleOrder++;

      // Seed lessons
      let lessonOrder = 1;
      for (const les of mod.lessons) {
        const [existingLes] = await pool.query(
          "SELECT id FROM lessons WHERE course_id = ? AND slug = ?",
          [courseId, les.slug]
        );
        if (existingLes.length > 0) {
          await pool.query(
            `UPDATE lessons 
             SET module_id = ?, title = ?, content_type = ?, content_text = ?, video_url = ?,
                 duration_minutes = ?, is_preview = ?, sort_order = ?
             WHERE id = ?`,
            [
              moduleId, les.title, les.content_type, les.content_text, les.video_url,
              les.duration_minutes, les.is_preview, lessonOrder, existingLes[0].id
            ]
          );
        } else {
          await pool.query(
            `INSERT INTO lessons 
             (course_id, module_id, title, slug, content_type, content_text, video_url, duration_minutes, is_preview, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              courseId, moduleId, les.title, les.slug, les.content_type, les.content_text, les.video_url,
              les.duration_minutes, les.is_preview, lessonOrder
            ]
          );
        }
        lessonOrder++;
      }
    }

    // Seed Quiz if present
    if (c.quiz) {
      const [existingQuiz] = await pool.query(
        "SELECT id FROM quizzes WHERE course_id = ? AND title = ?",
        [courseId, c.quiz.title]
      );
      let quizId;
      if (existingQuiz.length > 0) {
        quizId = existingQuiz[0].id;
        await pool.query(
          "UPDATE quizzes SET description = ?, passing_score = ?, time_limit_minutes = ? WHERE id = ?",
          [c.quiz.description, c.quiz.passing_score, c.quiz.time_limit_minutes, quizId]
        );
      } else {
        const [qRes] = await pool.query(
          "INSERT INTO quizzes (course_id, title, description, passing_score, time_limit_minutes) VALUES (?, ?, ?, ?, ?)",
          [courseId, c.quiz.title, c.quiz.description, c.quiz.passing_score, c.quiz.time_limit_minutes]
        );
        quizId = qRes.insertId;
      }

      // Questions
      let qOrder = 1;
      for (const q of c.quiz.questions) {
        const [existingQ] = await pool.query(
          "SELECT id FROM quiz_questions WHERE quiz_id = ? AND question_text = ?",
          [quizId, q.text]
        );
        let questionId;
        if (existingQ.length > 0) {
          questionId = existingQ[0].id;
          await pool.query(
            "UPDATE quiz_questions SET explanation = ?, sort_order = ? WHERE id = ?",
            [q.explanation, qOrder, questionId]
          );
        } else {
          const [qRes] = await pool.query(
            "INSERT INTO quiz_questions (quiz_id, question_text, explanation, sort_order) VALUES (?, ?, ?, ?)",
            [quizId, q.text, q.explanation, qOrder]
          );
          questionId = qRes.insertId;
        }
        qOrder++;

        // Options
        // Delete previous options for clean re-seeding
        await pool.query("DELETE FROM quiz_options WHERE question_id = ?", [questionId]);
        let optOrder = 1;
        for (const opt of q.options) {
          await pool.query(
            "INSERT INTO quiz_options (question_id, option_text, is_correct, sort_order) VALUES (?, ?, ?, ?)",
            [questionId, opt.text, opt.is_correct, optOrder]
          );
          optOrder++;
        }
      }
    }
  }

  console.log("Demonstration courses, modules, lessons, and quizzes seeded successfully!");
}

if (process.argv[1]?.endsWith("seedPlatformData.js")) {
  seedPlatformData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}

