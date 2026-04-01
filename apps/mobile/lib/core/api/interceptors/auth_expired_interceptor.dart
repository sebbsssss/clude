import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../router.dart';
import '../api_client_provider.dart';

class AuthExpiredInterceptor extends Interceptor {
  final Ref _ref;

  AuthExpiredInterceptor(this._ref);

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.response?.statusCode == 401) {
      final key = _ref.read(cortexKeyProvider);
      if (key != null) {
        _ref.read(cortexKeyProvider.notifier).state = null;
        _ref.read(authStateProvider.notifier).state = false;
        // GoRouter redirect handles navigation to /login
      }
    }
    handler.next(err);
  }
}
