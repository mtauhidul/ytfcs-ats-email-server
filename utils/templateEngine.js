// Email template processing
// utils/templateEngine.js
const processTemplate = (template, variables) => {
  let result = template;

  // Replace variables in the template
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    result = result.replace(regex, value || "");
  }

  return result;
};

module.exports = {
  processTemplate,
};
