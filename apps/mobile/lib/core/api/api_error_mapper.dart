import 'package:dio/dio.dart';

String mapDioError(DioException e) => switch (e.type) {
      DioExceptionType.connectionError =>
        'No internet connection. Check your network and try again.',
      DioExceptionType.connectionTimeout ||
      DioExceptionType.receiveTimeout ||
      DioExceptionType.sendTimeout =>
        'Request timed out. Try again.',
      DioExceptionType.badResponse => _mapBadResponse(e),
      _ => 'Something went wrong. Please try again.',
    };

String _mapBadResponse(DioException e) {
  final statusCode = e.response?.statusCode;
  if (statusCode == null || statusCode >= 500) {
    return 'Something went wrong on our end. Please try again shortly.';
  }
  // 401 is handled by AuthExpiredInterceptor, not shown to users.
  if (statusCode == 401) {
    return 'Session expired. Please sign in again.';
  }
  return 'Request failed (HTTP $statusCode).';
}
