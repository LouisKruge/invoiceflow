// ===========================================================================
// SIGNUP / FIRST ADMINISTRATOR
// ===========================================================================

async function handleSignupSubmit(event) {
  event.preventDefault();

  const form =
    event.currentTarget;

  if (!form) {
    return;
  }

  // -------------------------------------------------------------------------
  // Read fields directly from the form
  // -------------------------------------------------------------------------

  const formData =
    new FormData(form);

  const name =
    String(
      formData.get('name') ||
      ''
    ).trim();

  const email =
    String(
      formData.get('email') ||
      ''
    ).trim()
    .toLowerCase();

  const password =
    String(
      formData.get('password') ||
      ''
    );

  const companyName =
    String(
      formData.get('company_name') ||
      formData.get('companyName') ||
      ''
    ).trim();

  // -------------------------------------------------------------------------
  // Debug — never log the actual password
  // -------------------------------------------------------------------------

  console.log(
    '[Signup] Creating first administrator account:',
    {
      name,
      email,
      passwordProvided:
        password.length > 0,
      passwordLength:
        password.length,
      companyName
    }
  );

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  if (!name) {
    renderSignupPage(
      'Please enter your name.'
    );

    return;
  }

  if (!email) {
    renderSignupPage(
      'Please enter your email address.'
    );

    return;
  }

  if (!password) {
    renderSignupPage(
      'Please enter a password.'
    );

    return;
  }

  if (!companyName) {
    renderSignupPage(
      'Please enter your company name.'
    );

    return;
  }

  if (password.length < 8) {
    renderSignupPage(
      'Password must be at least 8 characters.'
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const submitBtn =
    form.querySelector(
      'button[type="submit"]'
    );

  if (submitBtn) {
    submitBtn.disabled =
      true;

    submitBtn.textContent =
      'Creating account…';
  }

  try {
    const response =
      await API.register(
        name,
        email,
        password,
        companyName
      );

    // -----------------------------------------------------------------------
    // Validate response
    // -----------------------------------------------------------------------

    if (
      !response ||
      !response.token
    ) {
      throw new Error(
        'Account was created but no login session was returned.'
      );
    }

    if (
      !response.user
    ) {
      throw new Error(
        'Account was created but no user profile was returned.'
      );
    }

    // -----------------------------------------------------------------------
    // Save authenticated session
    // -----------------------------------------------------------------------

    API.setToken(
      response.token
    );

    AppState.user =
      response.user;

    AppState.sessionError =
      null;

    console.log(
      '[Signup] Administrator account created successfully:',
      {
        id:
          response.user.id,

        email:
          response.user.email,

        company_name:
          response.user.company_name
      }
    );

    toast(
      'Account created successfully.',
      'success'
    );

    // -----------------------------------------------------------------------
    // Go directly to dashboard
    // -----------------------------------------------------------------------

    location.hash =
      '#/dashboard';

  } catch (error) {
    console.error(
      '[Signup] Registration failed:',
      error
    );

    if (submitBtn) {
      submitBtn.disabled =
        false;

      submitBtn.textContent =
        'Create account';
    }

    renderSignupPage(
      error?.message ||
      'Unable to create account.'
    );
  }
}
