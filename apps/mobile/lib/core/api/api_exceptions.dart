class ApiException implements Exception {
  final String message;
  ApiException(this.message);

  @override
  String toString() => 'ApiException: $message';
}

class AuthExpiredException extends ApiException {
  AuthExpiredException() : super('Session expired');
}

class NetworkException extends ApiException {
  NetworkException([super.message = 'Network error']);
}
