export interface IAccessTokenObtained {
  readonly obtained: true;
  readonly accessToken: string;
  readonly expiresIn?: number;
}

export interface IAccessTokenNotObtained {
  readonly obtained: false;
}

export type AccessTokenResult = IAccessTokenObtained | IAccessTokenNotObtained;

export interface IAccessTokenSource {
  obtainAccessToken(): Promise<AccessTokenResult>;
  reportAccessTokenRefused(accessToken: string): void;
}
