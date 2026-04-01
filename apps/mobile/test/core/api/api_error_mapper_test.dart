import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/core/api/api_error_mapper.dart';

void main() {
  group('mapDioError', () {
    test('connectionError returns no internet message', () {
      final e = DioException(
        type: DioExceptionType.connectionError,
        requestOptions: RequestOptions(),
      );
      expect(
        mapDioError(e),
        'No internet connection. Check your network and try again.',
      );
    });

    test('connectionTimeout returns timeout message', () {
      final e = DioException(
        type: DioExceptionType.connectionTimeout,
        requestOptions: RequestOptions(),
      );
      expect(mapDioError(e), 'Request timed out. Try again.');
    });

    test('receiveTimeout returns timeout message', () {
      final e = DioException(
        type: DioExceptionType.receiveTimeout,
        requestOptions: RequestOptions(),
      );
      expect(mapDioError(e), 'Request timed out. Try again.');
    });

    test('5xx server error returns generic server message', () {
      final e = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(),
        response: Response(
          requestOptions: RequestOptions(),
          statusCode: 500,
        ),
      );
      expect(
        mapDioError(e),
        'Something went wrong on our end. Please try again shortly.',
      );
    });

    test('503 server error returns generic server message', () {
      final e = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(),
        response: Response(
          requestOptions: RequestOptions(),
          statusCode: 503,
        ),
      );
      expect(
        mapDioError(e),
        'Something went wrong on our end. Please try again shortly.',
      );
    });

    test('4xx client error returns HTTP status message', () {
      final e = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(),
        response: Response(
          requestOptions: RequestOptions(),
          statusCode: 422,
        ),
      );
      expect(mapDioError(e), 'Request failed (HTTP 422).');
    });

    test('badResponse with null statusCode returns generic message', () {
      final e = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(),
      );
      expect(
        mapDioError(e),
        'Something went wrong on our end. Please try again shortly.',
      );
    });

    test('sendTimeout returns timeout message', () {
      final e = DioException(
        type: DioExceptionType.sendTimeout,
        requestOptions: RequestOptions(),
      );
      expect(mapDioError(e), 'Request timed out. Try again.');
    });

    test('401 returns session expired message', () {
      final e = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(),
        response: Response(
          requestOptions: RequestOptions(),
          statusCode: 401,
        ),
      );
      expect(mapDioError(e), 'Session expired. Please sign in again.');
    });

    test('unknown error type returns fallback message', () {
      final e = DioException(
        type: DioExceptionType.cancel,
        requestOptions: RequestOptions(),
      );
      expect(mapDioError(e), 'Something went wrong. Please try again.');
    });
  });
}
