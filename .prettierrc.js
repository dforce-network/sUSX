module.exports = {
  singleQuote: false,
  printWidth: 80,
  bracketSpacing: false,
  overrides: [
    {
      files: "*.sol",
      options: {
        printWidth: 80,
        singleQuote: false,
        bracketSpacing: true,
        parser: "solidity-parse",
      },
    },
    {
      files: "*.ts",
      options: {
        tabWidth: 2,
      },
    },
    {
      files: "*.js",
      options: {
        tabWidth: 2,
      },
    },
  ],
  plugins: [require("prettier-plugin-solidity")],
};
