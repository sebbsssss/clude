class Env {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://clude.io',
  );
  static const String devBaseUrl = 'http://localhost:3000';
}
