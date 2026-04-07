import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/auth_provider.dart';

class AuthExpiredInterceptor extends Interceptor {
  final Ref _ref;

  AuthExpiredInterceptor(this._ref);

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.response?.statusCode == 401) {
      debugPrint('[AUTH-INTERCEPTOR] 401 on ${err.requestOptions.method} ${err.requestOptions.path}');
      debugPrint('[AUTH-INTERCEPTOR] Auth header: ${err.requestOptions.headers['Authorization']?.toString().substring(0, 20) ?? 'NONE'}...');
      final auth = _ref.read(authNotifierProvider);
      if (auth.isAuthenticated) {
        debugPrint('[AUTH-INTERCEPTOR] Clearing auth!');
        _ref.read(authNotifierProvider.notifier).clearAuth();
      }
    }
    handler.next(err);
  }
}
